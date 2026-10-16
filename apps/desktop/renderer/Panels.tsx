import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api.ts";
import { Icon } from "../../../packages/ui/icons.tsx";
import { IconButton, Modal } from "./components.tsx";
import type {
  AIResult,
  ChangeSet,
  DocumentSnapshot,
  ProviderHealth,
  ProviderId,
  SyncStatus,
  VaultState,
  HistoryEntry,
} from "../../../packages/contracts/index.ts";

export function AIPanel({
  documents,
  activeId,
  onClose,
  onSettings,
  onApply,
  onError,
  beforeSend,
}: {
  documents: DocumentSnapshot[];
  activeId?: string;
  onClose: () => void;
  onSettings: () => void;
  onApply: (set: ChangeSet) => Promise<boolean>;
  onError: (m: string) => void;
  beforeSend?: () => Promise<boolean>;
}) {
  const [providers, setProviders] = useState<ProviderHealth[]>([]),
    [provider, setProvider] = useState<ProviderId>("codex"),
    [model, setModel] = useState(""),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(""),
    [result, setResult] = useState<AIResult | null>(null),
    [question, setQuestion] = useState(""),
    [previousMessages, setPreviousMessages] = useState<
      { question: string; text: string }[]
    >([]),
    [context, setContext] = useState<string[]>(activeId ? [activeId] : []),
    [selecting, setSelecting] = useState(false),
    [applied, setApplied] = useState(false);
  const transcript = useRef<HTMLDivElement>(null),
    health = providers.find((p) => p.id === provider);
  useEffect(() => {
    void api
      .request("providers.list", undefined)
      .then(setProviders)
      .catch((e) => onError(e.message));
    return api.subscribe((event) => {
      if (event.type === "ai" && event.state === "streaming") {
        const raw = event.text;
        const match = /"message"\s*:\s*"((?:\\.|[^"\\])*)/.exec(raw);
        if (match) {
          try {
            setText(JSON.parse(`"${match[1].replace(/\\$/, "")}"`));
          } catch {}
        } else if (!raw.trim().startsWith("{")) setText(raw);
      }
    });
  }, []);
  useEffect(() => {
    if (activeId && !context.length) setContext([activeId]);
  }, [activeId]);
  useEffect(() => {
    setContext((ids) => ids.filter((id) => documents.some((d) => d.id === id)));
  }, [documents]);
  useEffect(() => {
    transcript.current?.scrollTo({
      top: transcript.current.scrollHeight,
      behavior: "smooth",
    });
  }, [text, busy]);
  const send = async (value = prompt) => {
    if (!value.trim() || busy) return;
    if (!context.length) {
      setSelecting(true);
      onError("Choose the notes your assistant can read.");
      return;
    }
    if (beforeSend && !(await beforeSend())) return;
    if (question && text)
      setPreviousMessages((previous) => [...previous, { question, text }]);
    setQuestion(value);
    setPrompt("");
    setText("");
    setResult(null);
    setApplied(false);
    setBusy(true);
    try {
      const response = await api.request("ai.start", {
        provider,
        model: model || undefined,
        prompt: value,
        documentIds: context,
        conversationId: result?.conversationId,
      });
      setResult(response);
      setText(response.text);
    } catch (e: any) {
      onError(e.message);
      setPrompt(value);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="ai-panel" aria-label="AI assistant">
      <header className="panel-header">
        <span>
          <Icon name="ai" size={17} />
          Assistant
        </span>
        <IconButton icon="close" label="Close AI assistant" onClick={onClose} />
      </header>
      <div className="ai-transcript" ref={transcript}>
        {previousMessages.map((message, index) => (
          <div key={index}>
            <div className="ai-user-message">{message.question}</div>
            <div className="ai-response">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.text}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {!question ? (
          <div className="ai-welcome">
            <Icon name="ai" size={28} />
            <h2>A little help thinking it through.</h2>
            <p>
              Bring your own AI. Choose the notes it can read, then ask away.
            </p>
            <div className="ai-suggestions">
              {[
                "Summarize these notes",
                "Find the next steps",
                "Break this project into tasks",
              ].map((value) => (
                <button key={value} onClick={() => setPrompt(value)}>
                  {value}
                  <Icon name="right" size={14} />
                </button>
              ))}
            </div>
            {health && !health.authenticated && (
              <button className="text-button" onClick={onSettings}>
                Connect your subscription
                <Icon name="right" size={14} />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="ai-user-message">{question}</div>
            <div className="ai-response">
              {text ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {text}
                </ReactMarkdown>
              ) : busy ? (
                <div className="thinking-lines" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </div>
              ) : null}
            </div>
          </>
        )}
        {result?.changeSet && (
          <div className="proposal-summary">
            <Icon name="edit" size={17} />
            <span>
              {applied
                ? "Changes applied"
                : `${result.changeSet.changes.length} proposed file change${result.changeSet.changes.length === 1 ? "" : "s"}`}
            </span>
            {!applied && (
              <button
                className="button"
                onClick={() =>
                  onApply(result.changeSet!).then((value) => {
                    if (value) setApplied(true);
                  })
                }
              >
                Review changes
              </button>
            )}
          </div>
        )}
      </div>
      <div className="ai-context">
        <button
          className="context-toggle"
          onClick={() => setSelecting(!selecting)}
        >
          <Icon name="note" size={14} />
          {context.length
            ? `${context.length} note${context.length === 1 ? "" : "s"} in context`
            : "Choose context"}
          <Icon name={selecting ? "up" : "down"} size={13} />
        </button>
        {selecting && (
          <div className="context-list">
            {documents
              .filter((d) => d.kind !== "conversation")
              .map((d) => (
                <label key={d.id}>
                  <input
                    type="checkbox"
                    checked={context.includes(d.id)}
                    onChange={(e) =>
                      setContext((ids) =>
                        e.target.checked
                          ? [...ids, d.id]
                          : ids.filter((id) => id !== d.id),
                      )
                    }
                  />
                  <span>{d.title}</span>
                </label>
              ))}
          </div>
        )}
      </div>
      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Message your assistant"
          placeholder="Ask about your notes…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-controls">
          <select
            aria-label="AI provider"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ProviderId);
              setModel("");
            }}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
          <select
            aria-label="AI model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Default model</option>
            {health?.models.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {busy ? (
            <IconButton
              icon="close"
              label="Stop response"
              onClick={() => api.request("ai.cancel", undefined)}
            />
          ) : (
            <button
              className="send-button"
              type="submit"
              aria-label="Send message"
              disabled={!prompt.trim()}
            >
              <Icon name="up" size={16} />
            </button>
          )}
        </div>
      </form>
      <p className="ai-privacy">
        Selected notes and this conversation are sent to your provider.
      </p>
    </aside>
  );
}

export function ChangeReview({
  changeSet,
  documents,
  onClose,
  onApply,
}: {
  changeSet: ChangeSet;
  documents: DocumentSnapshot[];
  onClose: () => void;
  onApply: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const stale = changeSet.changes.some(
    (change) =>
      "baseRevision" in change &&
      documents.find((d) => d.id === change.documentId)?.revision !==
        change.baseRevision,
  );
  return (
    <Modal title="Review proposed changes" onClose={onClose} wide>
      <div className="review-body">
        <p>{changeSet.summary}</p>
        {stale && (
          <p className="form-error" role="alert">
            A file changed after this proposal. Ask for an updated proposal
            before applying.
          </p>
        )}
        {changeSet.changes.map((change, index) => {
          const doc =
            "documentId" in change
              ? documents.find((d) => d.id === change.documentId)
              : undefined;
          const after =
            change.type === "patch"
              ? [...change.edits]
                  .sort((a, b) => b.from - a.from)
                  .reduce(
                    (raw, edit) =>
                      raw.slice(0, edit.from) +
                      edit.insert +
                      raw.slice(edit.to),
                    doc?.raw ?? "",
                  )
              : change.type === "create"
                ? change.raw
                : "";
          return (
            <section key={index} className="file-review">
              <h3>
                <Icon name="note" size={15} />
                {doc?.path ?? ("path" in change ? change.path : "Document")}
              </h3>
              {change.type === "patch" || change.type === "create" ? (
                <div className="diff-columns">
                  <div>
                    <h4>Before</h4>
                    <pre>{doc?.raw ?? "New document"}</pre>
                  </div>
                  <div>
                    <h4>After</h4>
                    <pre>{after}</pre>
                  </div>
                </div>
              ) : (
                <p>
                  {change.type === "trash"
                    ? "Move this file to recovery history."
                    : `Move to ${change.path}`}
                </p>
              )}
            </section>
          );
        })}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className="modal-footer">
        <span>Files are checked again before changes are applied.</span>
        <button className="button" onClick={onClose}>
          Reject
        </button>
        <button
          className="button primary"
          disabled={busy || stale}
          onClick={async () => {
            setBusy(true);
            try {
              await onApply();
              onClose();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Applying…" : "Apply changes"}
        </button>
      </footer>
    </Modal>
  );
}

export type SettingsTab =
  "general" | "connections" | "sync" | "history" | "about";
export function Settings({
  initialTab,
  vault,
  syncStatus,
  onClose,
  onError,
  onOpenFolder,
  onDocument,
}: {
  initialTab: SettingsTab;
  vault: VaultState;
  syncStatus: SyncStatus;
  onClose: () => void;
  onError: (m: string) => void;
  onOpenFolder: () => void;
  onDocument: (id: string) => void;
}) {
  const [tab, setTab] = useState(initialTab),
    [providers, setProviders] = useState<ProviderHealth[]>([]),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [paths, setPaths] = useState<Record<string, string>>({}),
    [history, setHistory] = useState<HistoryEntry[]>([]);
  const refresh = async () => {
    setLoading(true);
    try {
      setProviders(await api.request("providers.list", undefined));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (tab === "connections") void refresh();
    if (tab === "history")
      void api
        .request("history.list", undefined)
        .then(setHistory)
        .catch((e) => onError(e.message));
  }, [tab]);
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {(
            [
              { id: "general", icon: "settings", label: "General" },
              { id: "connections", icon: "ai", label: "AI connections" },
              { id: "sync", icon: "cloud", label: "Sync" },
              { id: "history", icon: "waiting", label: "Local history" },
              { id: "about", icon: "help", label: "About" },
            ] as const
          ).map((item) => (
            <button
              className={tab === item.id ? "selected" : ""}
              key={item.id}
              onClick={() => {
                setMessage("");
                setTab(item.id);
              }}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "general" && (
            <>
              <h3>Your workspace</h3>
              <p className="muted">
                A normal folder, filled with your Markdown files.
              </p>
              <div className="setting-block">
                <label>Folder</label>
                <code className="folder-path">{vault.path}</code>
                <div className="button-row">
                  <button
                    className="button"
                    onClick={() =>
                      api
                        .request("documents.reveal", {})
                        .catch((e) => onError(e.message))
                    }
                  >
                    Show folder
                  </button>
                  <button className="button" onClick={onOpenFolder}>
                    Open another folder
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <span>Markdown documents</span>
                <span>{vault.documents.length}</span>
              </div>
              <div className="setting-row">
                <span>Tasks in your files</span>
                <span>
                  {vault.documents.reduce((n, d) => n + d.tasks.length, 0)}
                </span>
              </div>
              <p className="quiet-note">
                <Icon name="computer" size={15} />
                Editing, organizing, and search work offline.
              </p>
            </>
          )}
          {tab === "connections" && (
            <>
              <div className="settings-title-row">
                <h3>Your AI, connected</h3>
                <IconButton
                  icon="refresh"
                  label="Refresh connections"
                  disabled={loading}
                  onClick={refresh}
                />
              </div>
              <p className="muted">
                Use your existing subscription through the official runtime
                installed on this computer.
              </p>
              {loading && !providers.length && (
                <div className="connection-skeleton">
                  <i />
                  <i />
                </div>
              )}
              {providers.map((p) => (
                <section className="provider-setting" key={p.id}>
                  <div className="provider-heading">
                    <span className={`provider-letter ${p.id}`}>
                      {p.id === "codex" ? "O" : "C"}
                    </span>
                    <div>
                      <strong>{p.name}</strong>
                      <span>{p.version ?? "Runtime not detected"}</span>
                    </div>
                    <span
                      className={`connection-state ${p.authenticated && p.authMode === "subscription" ? "connected" : ""}`}
                    >
                      {p.authenticated && p.authMode === "subscription"
                        ? p.verified
                          ? "Ready"
                          : "Signed in"
                        : p.installed
                          ? "Sign in"
                          : "Not installed"}
                    </span>
                  </div>
                  <p>{p.message}</p>
                  <label className="field-label">
                    Executable path
                    <input
                      placeholder={p.path ?? `Path to ${p.id}`}
                      value={paths[p.id] ?? ""}
                      onChange={(e) =>
                        setPaths((s) => ({ ...s, [p.id]: e.target.value }))
                      }
                    />
                  </label>
                  <div className="button-row">
                    <button
                      className="button"
                      disabled={!p.installed}
                      onClick={async () => {
                        try {
                          const result = await api.request(
                            "providers.connect",
                            { provider: p.id },
                          );
                          setMessage(result.message);
                          if (result.url && !window.fable)
                            window.open(
                              result.url,
                              "_blank",
                              "noopener,noreferrer",
                            );
                        } catch (e: any) {
                          onError(e.message);
                        }
                      }}
                    >
                      Sign in with {p.id === "codex" ? "ChatGPT" : "Claude"}
                    </button>
                    {paths[p.id] && (
                      <button
                        className="button"
                        onClick={async () => {
                          try {
                            const next = await api.request(
                              "providers.configure",
                              { provider: p.id, path: paths[p.id] },
                            );
                            setProviders((current) =>
                              current.map((v) => (v.id === p.id ? next : v)),
                            );
                          } catch (e: any) {
                            onError(e.message);
                          }
                        }}
                      >
                        Save path
                      </button>
                    )}
                    <button
                      className="button"
                      disabled={
                        loading ||
                        !p.authenticated ||
                        p.authMode !== "subscription"
                      }
                      onClick={async () => {
                        setLoading(true);
                        try {
                          const next = await api.request("providers.test", {
                            provider: p.id,
                          });
                          setProviders((current) =>
                            current.map((v) => (v.id === p.id ? next : v)),
                          );
                          setMessage(
                            "Connection verified. The check was saved as Markdown.",
                          );
                        } catch (e: any) {
                          onError(e.message);
                          await refresh();
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      Test connection
                    </button>
                    <a
                      href={
                        p.id === "codex"
                          ? "https://learn.chatgpt.com/docs/cli"
                          : "https://code.claude.com/docs/en/setup"
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Setup guide
                      <Icon name="right" size={12} />
                    </a>
                  </div>
                </section>
              ))}
              {message && (
                <p className="inline-message" role="status">
                  {message}
                </p>
              )}
              <p className="quiet-note">
                Credentials stay with the provider. Fable does not sync them or
                switch to API billing.
              </p>
            </>
          )}
          {tab === "sync" && (
            <SyncSettingsPanel
              vault={vault}
              status={syncStatus}
              onError={onError}
              onDocument={onDocument}
            />
          )}
          {tab === "history" && (
            <>
              <h3>Local history</h3>
              <p className="muted">
                Previous changes are saved as Markdown recovery records in your
                folder.
              </p>
              <div className="history-list">
                {history.length ? (
                  history.map((entry) => (
                    <div key={entry.id}>
                      <span>
                        <strong>{entry.summary}</strong>
                        <small>
                          {new Date(entry.createdAt).toLocaleString()} ·{" "}
                          {entry.paths.length} file
                          {entry.paths.length === 1 ? "" : "s"}
                        </small>
                      </span>
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await api.request("history.undo", { id: entry.id });
                            setHistory(
                              await api.request("history.list", undefined),
                            );
                            setMessage("The change was restored.");
                          } catch (e: any) {
                            onError(e.message);
                          }
                        }}
                      >
                        Undo
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="muted">Your first edit will appear here.</p>
                )}
              </div>
              {message && <p className="inline-message">{message}</p>}
            </>
          )}
          {tab === "about" && (
            <div className="about-panel">
              <span className="fable-mark">f.</span>
              <h3>Fable</h3>
              <p>A quiet home for your notes, projects, and tasks.</p>
              <p className="about-principles">
                Your files.
                <br />
                Your AI.
                <br />
                Your data.
              </p>
              <small>
                Version 0.1.0 · Open source · MIT
                <br />
                Icons by Hugeicons
              </small>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
function SyncSettingsPanel({
  vault,
  status,
  onError,
  onDocument,
}: {
  vault: VaultState;
  status: SyncStatus;
  onError: (m: string) => void;
  onDocument: (id: string) => void;
}) {
  const hosted = import.meta.env.VITE_FABLE_SYNC_URL ?? "",
    hostedKey = import.meta.env.VITE_FABLE_SYNC_PUBLISHABLE_KEY ?? "";
  const [selfHosted, setSelfHosted] = useState(!hosted),
    [url, setUrl] = useState(hosted),
    [key, setKey] = useState(hostedKey),
    [vaultId, setVaultId] = useState(""),
    [recovery, setRecovery] = useState(""),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [step, setStep] = useState<"server" | "email" | "code" | "ready">("server"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [createdKey, setCreatedKey] = useState(""),
    [createdVault, setCreatedVault] = useState(""),
    [devices, setDevices] = useState<
      { id: string; name: string; current: boolean; revoked: boolean }[]
    >([]);
  const work = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const unmanaged = vault.documents.filter((d) => !d.managed);
  useEffect(() => {
    void api
      .request("sync.settings", undefined)
      .then((saved) => {
        if (saved) {
          setUrl(saved.url);
          setKey(saved.publishableKey);
          setVaultId(saved.vaultId ?? "");
          setSelfHosted(saved.url !== hosted);
        }
      })
      .catch((e: any) => onError(e.message));
  }, []);
  return (
    <>
      <h3>Your files, on your computers</h3>
      <p className="muted">
        Sync encrypts files and filenames on this device before uploading. Your
        local folder stays fully usable offline.
      </p>
      <div className={`sync-summary ${status.state}`}>
        <Icon name={status.state === "local" ? "computer" : "lock"} size={19} />
        <div>
          <strong>{status.message}</strong>
          {status.lastSynced && (
            <small>
              Last synced {new Date(status.lastSynced).toLocaleTimeString()}
            </small>
          )}
        </div>
        <IconButton
          icon="refresh"
          label="Sync now"
          onClick={() => work(() => api.request("sync.run", undefined))}
        />
      </div>
      {status.state === "local" ||
      status.state === "error" ||
      step !== "server" ? (
        <>
          <div className="segmented">
            <button
              disabled={!hosted}
              className={!selfHosted ? "selected" : ""}
              onClick={() => {
                setSelfHosted(false);
                setUrl(hosted);
                setKey(hostedKey);
              }}
            >
              Fable cloud
            </button>
            <button
              className={selfHosted ? "selected" : ""}
              onClick={() => {
                setSelfHosted(true);
                setUrl("");
                setKey("");
              }}
            >
              Self-hosted
            </button>
          </div>
          {!hosted && (
            <p className="field-hint">
              This build has no hosted server configured. Connect a self-hosted
              server, or configure the hosted endpoint when deploying Fable.
            </p>
          )}
          {step === "server" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  const result = await api.request("sync.configure", {
                    url,
                    publishableKey: key,
                    vaultId: vaultId || undefined,
                    recoveryKey: recovery || undefined,
                  });
                  setMessage(result.message);
                  if (result.recoveryKey) {
                    setCreatedKey(result.recoveryKey);
                    setCreatedVault(result.vaultId ?? "");
                    setStep("ready");
                  } else setStep("email");
                });
              }}
            >
              <label className="field-label">
                Server URL
                <input
                  type="url"
                  required
                  value={url}
                  placeholder="https://your-sync-server.example"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <label className="field-label">
                Publishable key
                <input
                  required
                  value={key}
                  placeholder="Your server’s public client key"
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <details className="existing-vault">
                <summary>Connect an existing synced vault</summary>
                <label className="field-label">
                  Vault ID
                  <input
                    value={vaultId}
                    onChange={(e) => setVaultId(e.target.value)}
                    placeholder="Existing vault UUID"
                  />
                </label>
                <label className="field-label">
                  Recovery key
                  <input
                    type="password"
                    autoComplete="off"
                    value={recovery}
                    onChange={(e) => setRecovery(e.target.value)}
                    placeholder="43 character recovery key"
                  />
                </label>
              </details>
              {unmanaged.length > 0 && (
                <div className="adoption-preview">
                  <strong>
                    {unmanaged.length} notes need a stable identity
                  </strong>
                  <p>
                    Connecting adds a small Fable ID to their YAML frontmatter.
                    Existing content and properties are preserved.
                  </p>
                  <ul>
                    {unmanaged.slice(0, 5).map((d) => (
                      <li key={d.id}>{d.path}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                className="button primary"
                disabled={busy || !url || !key}
              >
                {busy ? "Connecting…" : "Connect sync"}
              </button>
            </form>
          )}
          {step === "email" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  await api.request("sync.sendCode", { email });
                  setStep("code");
                  setMessage("Check your email for a sign-in code.");
                });
              }}
            >
              <label className="field-label">
                Email address
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? "Sending…" : "Send sign-in code"}
              </button>
            </form>
          )}
          {step === "code" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  const result = await api.request("sync.verifyCode", {
                    email,
                    code,
                  });
                  setMessage(result.message);
                  setCreatedKey(result.recoveryKey ?? "");
                  setCreatedVault(result.vaultId ?? "");
                  setStep("ready");
                  await api.request("sync.run", undefined);
                });
              }}
            >
              <label className="field-label">
                Email verification code
                <input
                  required
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Verification code"
                />
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? "Verifying…" : "Verify and enable sync"}
              </button>
            </form>
          )}
          {step === "ready" && (
            <div className="recovery-panel">
              <Icon name="lock" size={22} />
              <h4>Keep the key. Keep the vault.</h4>
              {createdKey ? (
                <>
                  <p>
                    Save this recovery key outside your vault. You’ll need it to
                    unlock your files on another computer.
                  </p>
                  <code>{createdKey}</code>
                  <button
                    className="button"
                    onClick={() =>
                      (api.copyText
                        ? api.copyText(createdKey)
                        : navigator.clipboard.writeText(createdKey)
                      )
                        .then(() => setMessage("Recovery key copied."))
                        .catch((e) => onError(e.message))
                    }
                  >
                    <Icon name="copy" size={14} />
                    Copy recovery key
                  </button>
                </>
              ) : (
                <p>Your vault is connected.</p>
              )}
              {createdVault && (
                <label className="field-label">
                  Vault ID<code>{createdVault}</code>
                </label>
              )}
            </div>
          )}
          {message && (
            <p className="inline-message" role="status">
              {message}
            </p>
          )}
        </>
      ) : null}
      {unmanaged.length > 0 && status.state !== "local" && (
        <div className="adoption-preview">
          <strong>{unmanaged.length} notes need a stable identity</strong>
          <p>
            Sync adds a Fable ID to these files. Other content and properties
            are preserved.
          </p>
          <ul>
            {unmanaged.slice(0, 10).map((d) => (
              <li key={d.path}>{d.path}</li>
            ))}
          </ul>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              work(async () => {
                await api.request("sync.adopt", undefined);
                await api.request("sync.run", undefined);
              })
            }
          >
            Add identities and resume sync
          </button>
        </div>
      )}
      {status.state !== "local" && (
        <>
          <div className="settings-title-row">
            <h4>Devices</h4>
            <button
              className="text-button"
              onClick={() =>
                work(async () =>
                  setDevices(await api.request("sync.devices", undefined)),
                )
              }
            >
              Refresh devices
            </button>
          </div>
          {devices.map((device) => (
            <div className="setting-row" key={device.id}>
              <span>
                {device.name}
                {device.current ? " · This device" : ""}
              </span>
              {device.revoked ? (
                <small>Disconnected</small>
              ) : (
                !device.current && (
                  <button
                    className="text-button"
                    onClick={() =>
                      work(async () => {
                        await api.request("sync.revoke", { id: device.id });
                        setDevices(
                          await api.request("sync.devices", undefined),
                        );
                      })
                    }
                  >
                    Disconnect
                  </button>
                )
              )}
            </div>
          ))}
          <button
            className="text-button danger"
            onClick={() =>
              work(() => api.request("sync.disconnect", undefined))
            }
          >
            Disconnect this vault
          </button>
        </>
      )}
      {status.conflicts.length > 0 && (
        <div className="sync-conflicts">
          <h4>Preserved conflict copies</h4>
          {status.conflicts.map((p) => (
            <button
              key={p}
              onClick={() => {
                const doc = vault.documents.find((d) => d.path === p);
                if (doc) onDocument(doc.id);
              }}
            >
              {p}
              <Icon name="right" size={14} />
            </button>
          ))}
        </div>
      )}
      <p className="quiet-note">
        Your sync account cannot recover your encryption key. Local files remain
        readable even if you stop using sync.
      </p>
    </>
  );
}
