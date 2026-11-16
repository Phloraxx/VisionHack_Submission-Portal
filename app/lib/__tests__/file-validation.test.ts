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

	it("rejects a file that is neither PDF, OLE2 nor ZIP", async () => {
		const junk = new TextEncoder().encode("MZ\u0000\u0000not a document");
		expect(await validateFileSignature(asFile(junk, "deck.pdf"))).toBe(false);
	});
});
