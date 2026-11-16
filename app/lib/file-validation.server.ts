/**
 * Server-only file validation logic.
 *
 * Extracted from submit-idea.tsx so that magic byte constants and signature
 * validation stay server-side and are not bundled into client JS.
 */

import { inflateRawSync } from "node:zlib";

/**
 * Magic bytes for file type verification (first bytes of the file).
 * Prevents renamed .exe files from being uploaded as PDF/PPT.
 */
const MAGIC_BYTES: Record<string, number[][]> = {
	pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
	ppt: [
		[0xd0, 0xcf, 0x11, 0xe0], // OLE2 (legacy .ppt)
	],
};

const ZIP_HEADER = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 — ZIP local file header

/**
 * OLE2 is the container for .doc, .xls, .msi and .ppt alike, so the magic
 * bytes alone cannot tell them apart. A PowerPoint document always carries a
 * `PowerPoint Document` directory entry, stored as UTF-16LE in the directory
 * stream — which the header locates, so it is not necessarily near the start.
 */
const OLE2_POWERPOINT_MARKER = "PowerPoint Document";
const CONTENT_TYPES_ENTRY = "[Content_Types].xml";

/** OLE2 (MS-CFB) header offsets, all little-endian. */
const OLE2_SECTOR_SHIFT = 30;
const OLE2_FIRST_DIR_SECTOR = 48;
const OLE2_DIFAT = 76;
/** The header's DIFAT holds this many FAT sector numbers inline. */
const OLE2_DIFAT_ENTRIES = 109;
/** `ENDOFCHAIN` / `FREESECT` — either one ends a sector chain. */
const OLE2_CHAIN_END = 0xfffffffe;

/**
 * Cap on the inflated size of a ZIP entry.
 *
 * `compSize` is bounded by the 10 MB upload cap, but the *uncompressed* size
 * is not: a deflate stream of zeros expands until the process runs out of
 * memory. A legitimate `[Content_Types].xml` is a few KB, so 4 MiB is
 * generous; anything larger is treated as invalid content.
 */
const MAX_INFLATED_BYTES = 4 << 20;

function matchesSignature(bytes: Uint8Array, sig: number[]): boolean {
	return sig.every((b, i) => bytes[i] === b);
}

/**
 * Walk a ZIP archive's local file headers, find `[Content_Types].xml`,
 * and return its decompressed content. Returns null if not found or the
 * archive is malformed. Uses Node's built-in zlib (no external dep).
 *
 * ZIP local file header layout (PKZip spec):
 *   0  signature  4  0x04034b50
 *   4  version    2
 *   6  flags      2
 *   8  method     2  (0=STORED, 8=DEFLATE)
 *  10  modtime    2
 *  12  moddate    2
 *  14  crc32      4
 *  18  compSize   4
 *  22  uncompSize 4
 *  26  nameLen    2
 *  28  extraLen   2
 *  30  name       nameLen
 *  …   extra      extraLen
 *  …   data       compSize
 */
function extractContentTypesXml(bytes: Uint8Array): string | null {
	for (let off = 0; off + 30 <= bytes.length; ) {
		if (
			bytes[off] !== 0x50 ||
			bytes[off + 1] !== 0x4b ||
			bytes[off + 2] !== 0x03 ||
			bytes[off + 3] !== 0x04
		) {
			break; // not a local file header — stop (central directory follows)
		}
		const method = bytes[off + 8] | (bytes[off + 9] << 8);
		const compSize =
			bytes[off + 18] | (bytes[off + 19] << 8) | (bytes[off + 20] << 16) | (bytes[off + 21] << 24);
		const nameLen = bytes[off + 26] | (bytes[off + 27] << 8);
		const extraLen = bytes[off + 28] | (bytes[off + 29] << 8);
		const nameStart = off + 30;
		const nameEnd = nameStart + nameLen;
		if (nameEnd > bytes.length) break;
		const name = new TextDecoder().decode(bytes.subarray(nameStart, nameEnd));
		const dataStart = nameEnd + extraLen;
		const dataEnd = dataStart + compSize;
		if (dataEnd > bytes.length) break;
		if (name === CONTENT_TYPES_ENTRY) {
			const entry = bytes.subarray(dataStart, dataEnd);
			try {
				const raw =
					method === 0 ? entry : inflateRawSync(entry, { maxOutputLength: MAX_INFLATED_BYTES });
				return new TextDecoder().decode(raw);
			} catch {
				// Malformed archive or a decompression bomb — both are invalid.
				return null;
			}
		}
		off = dataEnd; // advance to next local file header
	}
	return null;
}

/**
 * Whether the OLE2 container's directory stream carries a `PowerPoint
 * Document` entry.
 *
 * The entry lives in the directory stream, not in a fixed prefix: the header
 * points at the stream with `firstDirSector` and the FAT chains the rest, so
 * scanning the first 8 KiB misses real .ppt files whose directory sits
 * further in.
 */
function hasPowerPointDirectoryEntry(bytes: Uint8Array): boolean {
	if (bytes.length < 512) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const sectorSize = 1 << view.getUint16(OLE2_SECTOR_SHIFT, true);
	if (sectorSize < 512) return false;

	// Sector n starts at (n + 1) * sectorSize: the header occupies sector -1.
	// A sector that runs past the end of the file is not readable.
	const sectorStart = (sector: number): number => {
		const start = (sector + 1) * sectorSize;
		return start + sectorSize <= bytes.length ? start : -1;
	};

	// The FAT maps sector → next sector. Its own sector numbers come from the
	// header's DIFAT, which covers the first 109 FAT sectors — far more than a
	// 10 MB upload can need.
	const fat: number[] = [];
	for (let i = 0; i < OLE2_DIFAT_ENTRIES; i++) {
		const start = sectorStart(view.getUint32(OLE2_DIFAT + i * 4, true));
		if (start < 0) break;
		for (let off = start; off < start + sectorSize; off += 4) {
			fat.push(view.getUint32(off, true));
		}
	}

	const needle = Buffer.from(OLE2_POWERPOINT_MARKER, "utf16le");
	let sector = view.getUint32(OLE2_FIRST_DIR_SECTOR, true);
	// Bound the walk by the FAT length: a malformed chain must not loop.
	for (let hops = 0; hops < fat.length && sector < OLE2_CHAIN_END; hops++) {
		const start = sectorStart(sector);
		if (start < 0) return false;
		const entry = Buffer.from(bytes.buffer, bytes.byteOffset + start, sectorSize);
		if (entry.includes(needle)) return true;
		sector = fat[sector] ?? OLE2_CHAIN_END;
	}
	return false;
}

/**
 * Verify a file's magic bytes match the expected type.
 * Returns true if the file passes validation.
 *
 * - PDF: checks %PDF magic bytes.
 * - PPT (legacy): checks OLE2 magic bytes, then the directory stream for the
 *   `PowerPoint Document` entry.
 * - PPTX (OpenXML): checks ZIP header AND verifies the archive's
 *   `[Content_Types].xml` (DEFLATE-inflated) contains `presentationml`,
 *   rejecting other ZIP-based formats (.docx, .xlsx, .zip, .jar, etc.).
 *   Reads the whole file (≤10 MB per MAX_FILE_SIZE) because
 *   `[Content_Types].xml` is compressed and not in the first 4 KiB.
 */
export async function validateFileSignature(file: File): Promise<boolean> {
	// PDF
	const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	if (matchesSignature(head, MAGIC_BYTES.pdf[0])) return true;

	// OLE2 (legacy .ppt) — the container is shared with .doc/.xls/.msi, so the
	// PowerPoint stream name has to be present too.
	if (matchesSignature(head, MAGIC_BYTES.ppt[0])) {
		return hasPowerPointDirectoryEntry(new Uint8Array(await file.arrayBuffer()));
	}

	// PPTX (OpenXML) — ZIP header + content-type verification
	if (matchesSignature(head, ZIP_HEADER)) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const contentTypes = extractContentTypesXml(bytes);
		return contentTypes?.includes("presentationml") ?? false;
	}

	return false;
}
