/**
 * Canonical Jito tip accounts. Bundles must include a tip transfer to one of
 * these eight pubkeys for the Block Engine to route them. The same set is
 * used on devnet today.
 *
 * Source: https://docs.jito.wtf/lowlatencytxnsend/#tip-amount-and-accounts
 */
export const JITO_TIP_ACCOUNTS: readonly string[] = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pivKeVBBjQHkFRD1nSiA",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

/** Pick a random Jito tip account. */
export function pickJitoTipAccount(
  pool: readonly string[] = JITO_TIP_ACCOUNTS,
): string {
  return pool[Math.floor(Math.random() * pool.length)]!;
}
