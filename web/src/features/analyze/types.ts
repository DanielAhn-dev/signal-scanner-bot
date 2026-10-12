export type SignalTone = 'positive' | 'warning' | 'negative' | 'neutral'
export type NarrativeSignal = { label: string; detail: string; tone: SignalTone }
