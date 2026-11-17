import { useQuery } from "@tanstack/react-query"

import { apiWithMeta, ApiError } from "@/lib/api"
import type { Finding } from "@/lib/types"

// Every finding is in exactly one review state, so summing the four
// authoritative counts gives the true total without a fifth request.
export const REVIEW_STATES = ["verified", "needs_evidence", "ai_candidate", "false_positive"] as const
export type ReviewState = (typeof REVIEW_STATES)[number]

export interface FindingCounts extends Record<ReviewState, number> {
  /** ai_candidate + needs_evidence: findings that still need a human decision. */
  needsReview: number
  total: number
}

/**
 * Exact per-state finding counts from the filtered `X-Total-Count` header
 * (proposal 06). One-row requests keep the payload tiny, and every surface
 * that shows a count shares this cache entry so the numbers never disagree or
 * divide by a truncated 200-row page.
 */
export function useFindingCounts() {
  return useQuery({
    queryKey: ["findings", "counts"],
    queryFn: async (): Promise<FindingCounts> => {
      const entries = await Promise.all(
        REVIEW_STATES.map(async (state) => {
          const { totalCount } = await apiWithMeta<Finding[]>(`/api/findings?limit=1&status=${state}`)
          if (totalCount === null) {
            throw new ApiError(0, "The server did not report finding totals.")
          }
          return [state, totalCount] as const
        }),
      )
      const counts = Object.fromEntries(entries) as Record<ReviewState, number>
      return {
        ...counts,
        needsReview: counts.ai_candidate + counts.needs_evidence,
        total: REVIEW_STATES.reduce((sum, state) => sum + counts[state], 0),
      }
    },
  })
}
