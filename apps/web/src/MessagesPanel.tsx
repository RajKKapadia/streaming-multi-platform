import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { messageHistoryLimit, messageLimit, type MessagesSnapshot } from "@studio/contracts";
import { Button } from "@studio/ui";
import { api, studioPath } from "./api";

const emptySnapshot = (): MessagesSnapshot => ({ sessionId: "", revision: -1, messages: [] });

export function useStudioMessages({
  studioId,
  identity,
  name,
  host,
  preview,
  connected,
  visible,
}: {
  studioId: string;
  identity: string;
  name: string;
  host: boolean;
  preview: boolean;
  connected: boolean;
  visible: boolean;
}) {
  const [snapshot, setSnapshot] = useState(emptySnapshot),
    [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false),
    [loading, setLoading] = useState(!preview),
    [loadError, setLoadError] = useState(""),
    [sendError, setSendError] = useState(""),
    [readIds, setReadIds] = useState<Set<string>>(new Set());
  const current = useRef(snapshot),
    requestNumber = useRef(0),
    appliedRequest = useRef(0),
    busy = useRef(false);
  const scope = `${studioId}:${identity}:${preview}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(() => {
    activeScope.current = scope;
    current.current = emptySnapshot();
    busy.current = false;
    setSnapshot(current.current);
    setSending(false);
    setDraft("");
    setReadIds(new Set());
    setLoading(!preview);
    setLoadError("");
    setSendError("");
  }, [scope, preview]);
  const accept = useCallback(
    (next: MessagesSnapshot, request: number) => {
      if (activeScope.current !== scope) return;
      const previous = current.current;
      // A delayed poll must not overwrite a newly sent message or a newer server session.
      if (
        next.sessionId === previous.sessionId
          ? next.revision <= previous.revision
          : request < appliedRequest.current
      )
        return;
      appliedRequest.current = Math.max(appliedRequest.current, request);
      current.current = next;
      setSnapshot(next);
    },
    [scope],
  );
  useEffect(() => {
    if (preview || !connected) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      const request = ++requestNumber.current;
      try {
        const next = await api<MessagesSnapshot>(studioPath(studioId, "messages"));
        if (alive) {
          accept(next, request);
          setLoadError("");
          setLoading(false);
        }
      } catch (e) {
        if (alive) {
          setLoadError((e as Error).message);
          setLoading(false);
        }
      } finally {
        if (alive) timer = setTimeout(() => void sync(), 1000);
      }
    };
    void sync();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [studioId, preview, connected, accept]);
  useEffect(() => {
    if (visible) setReadIds(new Set(snapshot.messages.map((message) => message.id)));
  }, [visible, snapshot.messages]);
  const send = async () => {
    const text = draft.trim();
    if (!text || busy.current || !connected) return;
    busy.current = true;
    setSending(true);
    setSendError("");
    const request = ++requestNumber.current;
    try {
      const next = preview
        ? {
            sessionId: "preview",
            revision: current.current.revision + 1,
            messages: [
              ...current.current.messages,
              {
                id: crypto.randomUUID(),
                identity,
                name,
                role: host ? ("host" as const) : ("guest" as const),
                text,
                sentAt: Date.now(),
              },
            ].slice(-messageHistoryLimit),
          }
        : await api<MessagesSnapshot>(studioPath(studioId, "messages"), { text });
      if (activeScope.current === scope) {
        accept(next, request);
        setDraft("");
        setLoading(false);
      }
    } catch (e) {
      if (activeScope.current === scope) setSendError((e as Error).message);
    } finally {
      if (activeScope.current === scope) {
        busy.current = false;
        setSending(false);
      }
    }
  };
  return {
    messages: snapshot.messages,
    unread: visible
      ? 0
      : snapshot.messages.filter((m) => m.identity !== identity && !readIds.has(m.id)).length,
    draft,
    setDraft,
    send,
    sending,
    loading,
    error: sendError || loadError,
  };
}

export function MessagesPanel({
  chat,
  identity,
  connected,
  preview,
}: {
  chat: ReturnType<typeof useStudioMessages>;
  identity: string;
  connected: boolean;
  preview: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = list.current;
    if (element && chat.messages.length) element.scrollTop = element.scrollHeight;
  }, [chat.messages]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void chat.send();
  };
  return (
    <aside className="media-panel messages-panel" aria-label="Studio messages">
      <div className="panel-header">
        <div>
          <MessageSquare size={17} />
          <strong>Messages</strong>
        </div>
      </div>
      <p className="panel-note">
        {preview
          ? "Preview messages stay on this device."
          : "Chat with the host and guests. Messages stay inside the studio."}
      </p>
      <div
        ref={list}
        className="message-list"
        role="log"
        aria-label="Studio conversation"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
      >
        {chat.messages.length === 0 ? (
          <div className="messages-empty">
            <MessageSquare size={30} />
            <h3>{chat.loading ? "Loading messages…" : "Start the conversation"}</h3>
            <p>Share a note with everyone in the studio, on stage or backstage.</p>
          </div>
        ) : (
          chat.messages.map((message) => (
            <article
              key={message.id}
              className={`studio-message ${message.identity === identity ? "own-message" : ""}`}
            >
              <div className="message-meta">
                <strong>
                  {message.name}
                  {message.identity === identity ? " (you)" : ""}
                </strong>
                {message.role === "host" && <span className="message-role">Host</span>}
                <time dateTime={new Date(message.sentAt).toISOString()}>
                  {new Date(message.sentAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p>{message.text}</p>
            </article>
          ))
        )}
      </div>
      <form className="message-composer" onSubmit={submit}>
        {!connected && <p className="hint">Reconnect to send messages.</p>}
        {chat.error && (
          <p className="error" role="alert">
            {chat.error}
          </p>
        )}
        <label className="sr-only" htmlFor="studio-message">
          Message everyone in the studio
        </label>
        <textarea
          id="studio-message"
          className="ui-input"
          placeholder="Message the studio…"
          rows={3}
          maxLength={messageLimit}
          value={chat.draft}
          onChange={(e) => chat.setDraft(e.target.value)}
          disabled={!connected}
          readOnly={chat.sending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void chat.send();
            }
          }}
        />
        <div className="message-composer-actions">
          <span>Enter to send · Shift + Enter for a new line</span>
          <Button
            type="submit"
            size="sm"
            disabled={!connected || chat.sending || !chat.draft.trim()}
          >
            <Send size={14} />
            {chat.sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </aside>
  );
}
