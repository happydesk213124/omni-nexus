/** Shared by separate comic calls and pages requested with the main tagger. */
export function comicNaturalInstruction(enabled: boolean): string {
  return enabled
    ? 'Comic natural supplement ON: keep each cuts[].base as the existing place/camera/composition/lighting comma tags. Also write cuts[].natural: 2–5 detailed English sentences describing exactly that cut: framing, viewpoint, visible subjects and their relative positions, who does what to whom, expressions, visible clothing, and lighting. Identify people by position or appearance, not names. Describe only visible details consistent with that cut type; preserve closeup/cross_section/upperbody exclusions. No dialogue, invented events, or details from other cuts. This field is separate from shot-level natural.'
    : 'Comic natural supplement OFF: omit cuts[].natural; keep the existing cut base tags.';
}
