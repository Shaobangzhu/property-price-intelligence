type Kind = 'empty' | 'loading' | 'error';

export function FeedbackState({ kind, title, message, compact = false }: { kind: Kind; title: string; message: string; compact?: boolean }) {
  return <div className={`feedback-state feedback-${kind}${compact ? ' feedback-compact' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>
    <span className="feedback-glyph" aria-hidden="true">{kind === 'loading' ? '◌' : kind === 'error' ? '!' : '◇'}</span>
    <strong>{title}</strong>
    <p>{message}</p>
  </div>;
}
