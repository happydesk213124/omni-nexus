/** The preview control must participate in all three final settings collectors. */
export function repairGuardrailPreset(source) {
  const seam = '      llm_reverse_bar:';
  if (source.split(seam).length !== 4) throw new Error('[guardrail preset] collector needle drift');
  const habit = 'llm-json-retry|llm-reverse-bar|llm-tag-cal|preprocess';
  if (source.split(habit).length !== 2) throw new Error('[guardrail preset] change handler needle drift');
  return source.split(seam).join('      llm_guardrail_preset: document.getElementById("nx-llm-guardrail-preset") ? N("nx-llm-guardrail-preset") || "none" : (t.backendSettings?.card?.llm_guardrail_preset || "none"),\n' + seam)
    .replace(habit, 'llm-json-retry|llm-guardrail-preset|llm-reverse-bar|llm-tag-cal|preprocess');
}
