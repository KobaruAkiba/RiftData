import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FIXTURES_DIR = "tests/fixtures/livestats";
export const MAX_FIXTURE_BYTES = 200_000;

/**
 * Saves a fixture under tests/fixtures/livestats, LF line endings, trailing newline.
 * `pretty` = 2-space indentation; compact output keeps large feed responses under the size cap.
 * Throws when the file would exceed 200 KB.
 */
export async function writeFixture(relPath: string, data: unknown, pretty: boolean): Promise<number> {
  const text = (pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + "\n";
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_FIXTURE_BYTES) throw new Error(`fixture ${relPath} is ${bytes} bytes, over ${MAX_FIXTURE_BYTES}`);
  const file = `${FIXTURES_DIR}/${relPath}`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return bytes;
}
