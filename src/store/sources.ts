import { Directory, File, Paths } from 'expo-file-system';

/** Original assignment PDFs (base64) kept on-device so parsing can be retried later. */
const dir = new Directory(Paths.document, 'penquire', 'sources');
const fileFor = (assignmentId: string) => new File(dir, `${assignmentId}.pdf.b64`);

export function saveSource(assignmentId: string, base64: string) {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const f = fileFor(assignmentId);
  if (!f.exists) f.create({ intermediates: true });
  f.write(base64);
}

export function readSource(assignmentId: string): string | null {
  const f = fileFor(assignmentId);
  return f.exists ? f.textSync() : null;
}
