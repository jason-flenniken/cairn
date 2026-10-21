// A small built-in price table for the agent cards' cost estimate (FR-12). The cost is an estimate, shown with "~":
// the table is by model family, so a new point version still estimates and an unknown model shows tokens only.
// Source: Anthropic's published API pricing, US dollars per million tokens, as of 2026-10-21. Update here when it changes.

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** A price with the cache rates at their usual multiples of the input rate (read 0.1x, 5-minute write 1.25x). */
const price = (input: number, output: number): Price => ({ input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 })

const OPUS = price(5, 25)
const OPUS_4_0 = price(15, 75)
const SONNET = price(3, 15)
const HAIKU = price(1, 5)
const HAIKU_3_5 = price(0.8, 4)

export type PriceUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

/** The price of a model id by its family (claude-opus-5-5, claude-sonnet-4-5-20250929, ...), or undefined for a model not in the table. */
function priceOf(model: string): Price | undefined {
  const id = model.toLowerCase().replace(/\[.*\]$/, '')
  if (id.includes('opus')) return /opus-4(-1)?(-\d{8})?$|3-opus/.test(id) ? OPUS_4_0 : OPUS
  if (id.includes('sonnet')) return SONNET
  if (id.includes('haiku')) return /3-5-haiku|haiku-3-5/.test(id) ? HAIKU_3_5 : HAIKU
  return undefined
}

/** What a call cost in US dollars by the table, or undefined when the model is not in it. */
export function estimateUsd(model: string, usage: PriceUsage): number | undefined {
  const p = priceOf(model)
  if (p === undefined) return undefined
  const perToken = (rate: number, tokens: number | undefined) => ((tokens ?? 0) * rate) / 1_000_000
  return perToken(p.input, usage.input_tokens) + perToken(p.output, usage.output_tokens) + perToken(p.cacheRead, usage.cache_read_input_tokens) + perToken(p.cacheWrite, usage.cache_creation_input_tokens)
}
