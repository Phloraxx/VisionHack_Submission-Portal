import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { validateFileSignature } from "../file-validation.server";

const CONTENT_TYPES = "[Content_Types].xml";

/**
 * Build a ZIP archive with a single local file header.
 *
 * Only the fields `extractContentTypesXml` reads are populated; the CRC and
 * the central directory are irrelevant to the validator.
 */
function zipWithEntry(name: string, data: Uint8Array, method: 0 | 8): Uint8Array {
	const nameBytes = new TextEncoder().encode(name);
	const header = new Uint8Array(30 + nameBytes.length);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x04034b50, true); // local file header signature
	view.setUint16(4, 20, true); // version needed
	view.setUint16(6, 0, true); // flags
	view.setUint16(8, method, true); // compression method
	view.setUint32(18, data.length, true); // compressed size
	view.setUint32(22, data.length, true); // uncompressed size
	view.setUint16(26, nameBytes.length, true); // name length
	view.setUint16(28, 0, true); // extra length
	header.set(nameBytes, 30);

	const out = new Uint8Array(header.length + data.length);
	out.set(header, 0);
	out.set(data, header.length);
	return out;
}

/**
 * Build a minimal OLE2 (MS-CFB) container.
 *
 * Only the fields the validator reads are populated: the header's sector shift
 * and `firstDirSector`, one FAT sector, and the directory sector holding a
 * single entry name. `dirSector` is a parameter so a test can place the
 * directory past the first 8 KiB, which is where a real .ppt keeps it.
 */
function ole2Container(options: { dirSector: number; entryName: string | null }): Uint8Array {
	const SECTOR = 512;
	const { dirSector, entryName } = options;
	// Sector n occupies [(n + 1) * SECTOR, (n + 2) * SECTOR), so the file has
	// to reach one sector past the directory.
	const bytes = new Uint8Array((dirSector + 2) * SECTOR);
	const view = new DataView(bytes.buffer);

	// Header: OLE2 magic, 512-byte sectors, FAT in sector 0, directory at
	// `dirSector`.
	bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
	view.setUint16(30, 9, true); // sector shift → 1 << 9 = 512
	view.setUint32(48, dirSector, true); // first directory sector
	view.setUint32(76, 0, true); // DIFAT[0] → FAT sector 0

	// FAT: every sector ends its own chain.
	for (let i = 0; i < SECTOR / 4; i++) view.setUint32(SECTOR + i * 4, 0xfffffffe, true);

	if (entryName) {
		// Directory entry name: 64 bytes of UTF-16LE at the start of the sector.
		bytes.set(Buffer.from(entryName, "utf16le").subarray(0, 64), (dirSector + 1) * SECTOR);
	}
	return bytes;
}

function asFile(bytes: Uint8Array, name = "deck.pptx"): File {
	// Copy into a fresh ArrayBuffer so the Blob constructor sees a plain view.
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return new File([buffer], name, { type: "application/octet-stream" });
}

describe("validateFileSignature", () => {
	it("accepts a PDF by magic bytes", async () => {
		const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
		expect(await validateFileSignature(asFile(pdf, "deck.pdf"))).toBe(true);
	});

	it("accepts a PPTX whose [Content_Types].xml names presentationml", async () => {
		const xml = new TextEncoder().encode(
			'<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
		);
		const zip = zipWithEntry(CONTENT_TYPES, deflateRawSync(xml), 8);
		expect(await validateFileSignature(asFile(zip))).toBe(true);
	});

	it("rejects a ZIP whose [Content_Types].xml is not a presentation", async () => {
		const xml = new TextEncoder().encode(
			'<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
		);
		const zip = zipWithEntry(CONTENT_TYPES, deflateRawSync(xml), 8);
		expect(await validateFileSignature(asFile(zip))).toBe(false);
	});

	/**
	 * F-62 regression: a deflate bomb in `[Content_Types].xml` must be rejected
	 * instead of inflating until the process runs out of memory.
	 */
	it("rejects a decompression bomb instead of inflating it", async () => {
		// 8 MiB of zeros compresses to a few KB — well inside the upload cap.
		const bomb = deflateRawSync(Buffer.alloc(8 << 20));
		expect(bomb.length).toBeLessThan(1024 * 1024);
		const zip = zipWithEntry(CONTENT_TYPES, bomb, 8);
		expect(await validateFileSignature(asFile(zip))).toBe(false);
	});

	/**
	 * R-11 regression: the legacy-.ppt check scanned only the first 8 KiB, but
	 * the `PowerPoint Document` entry lives in the directory stream the header
	 * points at — routinely past that prefix.
	 */
	it("accepts a legacy .ppt whose directory entry sits past the first 8 KiB", async () => {
		const ppt = ole2Container({ dirSector: 20, entryName: "PowerPoint Document" });
		expect(ppt.length).toBeGreaterThan(8 * 1024);
		expect(await validateFileSignature(asFile(ppt, "deck.ppt"))).toBe(true);
	});

	it("rejects an OLE2 container whose directory has no PowerPoint entry", async () => {
		const doc = ole2Container({ dirSector: 20, entryName: "WordDocument" });
		expect(await validateFileSignature(asFile(doc, "deck.ppt"))).toBe(false);
	});

	it("rejects an OLE2 container with an empty directory", async () => {
		const empty = ole2Container({ dirSector: 20, entryName: null });
		expect(await validateFileSignature(asFile(empty, "deck.ppt"))).toBe(false);
	});

	it("rejects a file that is neither PDF, OLE2 nor ZIP", async () => {
		const junk = new TextEncoder().encode("MZ\u0000\u0000not a document");
		expect(await validateFileSignature(asFile(junk, "deck.pdf"))).toBe(false);
	});
});
