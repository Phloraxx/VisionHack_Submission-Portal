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
const CONTENT_TYPES_ENTRY = "[Content_Types].xml";

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
				const raw = method === 0 ? entry : inflateRawSync(entry);
				return new TextDecoder().decode(raw);
			} catch {
				return null;
			}
		}
		off = dataEnd; // advance to next local file header
	}
	return null;
}

/**
 * Verify a file's magic bytes match the expected type.
 * Returns true if the file passes validation.
 *
 * - PDF: checks %PDF magic bytes.
 * - PPT (legacy): checks OLE2 magic bytes.
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

	// OLE2 (legacy .ppt)
	if (matchesSignature(head, MAGIC_BYTES.ppt[0])) return true;

	// PPTX (OpenXML) — ZIP header + content-type verification
	if (matchesSignature(head, ZIP_HEADER)) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const contentTypes = extractContentTypesXml(bytes);
		return contentTypes?.includes("presentationml") ?? false;
	}

	return false;
}
