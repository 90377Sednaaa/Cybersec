import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { LLMModelsResponse, LLMProvider } from "@/lib/types"

export interface ModelCapabilities {
  supportedEfforts: string[]
  defaultEffort: string | null
  reasoning: boolean
  fromCatalog: boolean
}

/**
 * Shared live-catalog query. The model picker and every task row read the same
 * cached response, so switching between them never refetches the catalog.
 */
export function useModelCatalog(provider: LLMProvider | null, zdr = false) {
  return useQuery({
    queryKey: ["llm-models", provider?.id ?? null, zdr],
    queryFn: () =>
      api<LLMModelsResponse>(
        `/api/settings/llm/providers/${provider?.id}/models${zdr ? "?zdr=true" : ""}`,
      ),
    enabled: Boolean(provider),
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}
