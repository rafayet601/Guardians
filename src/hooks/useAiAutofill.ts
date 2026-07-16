import { useMutation } from '@tanstack/react-query';

import { getReportAutofill } from '@/api/ai';
import { track } from '@/lib/observability';
import type { ReportAutofillInput, ReportAutofillSuggestion } from '@/types/ai';

/**
 * Photo → report autofill (AI-M1 #1). React Query mutation that sends one
 * base64 photo to the `ai-report-autofill` Edge Function and returns an
 * editable suggestion for the report form. Instruments `ai_report_autofill_used`
 * on success. The caller prefills the form with the result — it is never wired
 * straight into createSighting.
 */
export function useAiAutofill() {
  return useMutation<ReportAutofillSuggestion, Error, ReportAutofillInput>({
    mutationFn: (input) => getReportAutofill(input),
    onSuccess: (suggestion) => {
      track('ai_report_autofill_used', { isInjured: suggestion.isInjured });
    },
  });
}
