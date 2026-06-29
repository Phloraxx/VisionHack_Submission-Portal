/**
 * Server-only file validation logic.
 *
 * Extracted from submit-idea.tsx so that magic byte constants and signature
 * validation stay server-side and are not bundled into client JS.
 */

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

const ZIP_HEADER = [0x50, 0x4b, 0x03, 0x04];

function matchesSignature(bytes: Uint8Array, sig: number[]): boolean {
	return sig.every((b, i) => bytes[i] === b);
}

/**
 * Verify a file's magic bytes match the expected type.
 * Returns true if the file passes validation.
 *
 * - PDF: checks %PDF magic bytes.
 * - PPT (legacy): checks OLE2 magic bytes.
 * - PPTX (OpenXML): checks ZIP header AND verifies the archive contains
 *   `presentationml` content-type in its `[Content_Types].xml`, rejecting
 *   other ZIP-based formats (.docx, .xlsx, .zip, .jar, etc.).
 */
export async function validateFileSignature(file: File): Promise<boolean> {
	// Read enough for magic bytes + OpenXML content-type detection.
	// 4 KiB captures the ZIP central directory and [Content_Types].xml for
	// typical Office Open XML files.
	const buffer = await file.slice(0, 4096).arrayBuffer();
	const bytes = new Uint8Array(buffer);

	// PDF
	if (matchesSignature(bytes, MAGIC_BYTES.pdf[0])) return true;

	// OLE2 (legacy .ppt)
	if (matchesSignature(bytes, MAGIC_BYTES.ppt[0])) return true;

	// ZIP header — must also contain presentationml to be a PPTX
	if (matchesSignature(bytes, ZIP_HEADER)) {
		const text = new TextDecoder().decode(bytes);
		return text.includes("presentationml");
	}

	return false;
}
