/**
 * Server-only file validation logic.
 *
 * Extracted from submit-idea.tsx so that magic byte constants and signature
 * validation stay server-side and are not bundled into client JS.
 */

// Magic bytes for file type verification (first bytes of the file)
// Prevents renamed .exe files from being uploaded as PDF/PPT
const MAGIC_BYTES: Record<string, number[][]> = {
	pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
	// Accept both old OLE2 PPT and modern ZIP-based PPTX (which has ZIP header).
	// The ZIP check alone is not unique to PPTX (also matches .docx, .xlsx, .zip),
	// so both OLE2 and ZIP magic signatures are verified independently against
	// raw bytes to prevent renamed .exe files.
	ppt: [
		[0xd0, 0xcf, 0x11, 0xe0], // OLE2 (PPT)
		[0x50, 0x4b, 0x03, 0x04], // ZIP/OpenXML (PPTX)
	],
};

/**
 * Verify a file's magic bytes match the expected type.
 * Returns true if the file passes validation.
 */
export async function validateFileSignature(file: File): Promise<boolean> {
	// Read 16 bytes for magic byte checking — sufficient for PDF (%PDF) and
	// OLE2 PPT (D0CF11E0). ZIP header (PK\x03\x04) is at offset 0-3, also
	// covered by 16 bytes. Insufficient for deep MIME validation, but good
	// enough to reject renamed .exe files.
	const buffer = await file.slice(0, 16).arrayBuffer();
	const bytes = new Uint8Array(buffer);

	// Check all magic byte signatures against the raw bytes regardless of
	// claimed MIME type or file extension (both client-supplied and trivially
	// spoofable). Return true if any signature matches.
	const match = Object.values(MAGIC_BYTES).some((sigs) =>
		sigs.some((sig) => sig.every((b, i) => bytes[i] === b)),
	);

	return match;
}
