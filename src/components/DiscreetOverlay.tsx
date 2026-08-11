interface Props {
  message: string;
  onUnlock: () => void;
}

/**
 * What a participant sees while a take is running in discreet mode.
 *
 * No timer, no counter, no red anything — the point is that a visible recording
 * indicator is itself a confound in a study about how people behave during a
 * conversation. Participants have consented to being recorded under IRB
 * 2020-1657; what is being suppressed is a salient reminder, not the fact.
 *
 * What this cannot do, and does not pretend to: the camera's own hardware
 * activity light, the macOS green camera indicator, and the Windows "camera in
 * use" indicator are all enforced below the application layer. None of them can
 * be switched off by any app, and no attempt is made to.
 *
 * The unlock is a keyboard chord rather than a button so that a participant
 * cannot end a session by touching the keyboard, and so nothing on screen
 * invites them to try.
 */
export default function DiscreetOverlay({ message, onUnlock }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex cursor-default select-none items-center justify-center bg-[--color-panel]"
      onDoubleClick={onUnlock}
    >
      <p className="px-10 text-center text-2xl font-light text-[--color-ink-dim]">
        {message}
      </p>

      {/* Deliberately dim and in a corner: enough for an operator who knows to
          look, invisible to anyone who does not. */}
      <p className="absolute bottom-3 right-4 text-[10px] text-[--color-panel-edge]">
        Ctrl + Shift + R
      </p>
    </div>
  );
}
