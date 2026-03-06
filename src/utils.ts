const CURL_EXEC_NAME = process.env.CURL_EXEC_NAME;
const CURL_IMPERSONATE = process.env.CURL_IMPERSONATE;
const CURL_TIMEOUT_MS = 10_000;

export async function getGiftInfo(slug: string) {
  console.log("[getGiftInfo] start", slug);

  if (!CURL_EXEC_NAME || !CURL_IMPERSONATE) {
    throw new Error("NO CURL_EXEC_NAME/CURL_IMPERSONATE");
  }

  const p = Bun.spawn({
    cmd: [
      CURL_EXEC_NAME,
      "--impersonate",
      CURL_IMPERSONATE,
      "-sS",
      "-L",
      "--compressed",
      "-H",
      "Accept: application/json, text/plain, */*",
      "-H",
      "Accept-Language: en-US,en;q=0.9",
      "-H",
      "Referer: https://xgift.tg/",
      "-H",
      "Origin: https://xgift.tg",
      "-H",
      "Sec-Fetch-Dest: empty",
      "-H",
      "Sec-Fetch-Mode: cors",
      "-H",
      "Sec-Fetch-Site: same-site",
      `https://app-api.xgift.tg/gifts/${slug}`,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    p.kill();
  }, CURL_TIMEOUT_MS);

  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]).finally(() => clearTimeout(timeout));

  if (timedOut) {
    console.log("[getGiftInfo] timed out for", slug);
    throw new Error(`curl request timed out after ${CURL_TIMEOUT_MS / 1000}s`);
  }

  if (code !== 0) {
    console.log(`[getGiftInfo] error code for ${slug} ${code}`);
    throw new Error(err.trim() || `curl exited with code ${code}`);
  }

  console.log(`[getGiftInfo] return data for ${slug}`);

  return JSON.parse(out) as { estimatedPriceTon: number; saleData?: { salePriceTon: number } };
}
