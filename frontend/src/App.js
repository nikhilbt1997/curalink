import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

const API_BASE = 'https://curalink-node-api.onrender.com/api';

function generateSessionId() {
  return 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// ── ICONS ─────────────────────────────────────────────────────────────────────
const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13"></line>
    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
  </svg>
);
const PulseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
  </svg>
);
const BookIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
  </svg>
);
const FlaskIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 3H15"></path><path d="M10 3v6l-4 8a1 1 0 0 0 .9 1.5h10.2A1 1 0 0 0 18 17L14 9V3"></path>
  </svg>
);
const SpinnerIcon = () => (
  <svg className="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
  </svg>
);
const NewChatIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 5v14M5 12h14"></path>
  </svg>
);
const LinkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);
const UserIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
);

// ── PUBLICATION CARD ──────────────────────────────────────────────────────────
function PublicationCard({ pub, index }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card pub-card" style={{ animationDelay: `${index * 0.05}s` }}>
      <div className="card-header">
        <span className={`badge badge-${pub.source === 'PubMed' ? 'pubmed' : 'openalex'}`}>
          <BookIcon /> {pub.source}
        </span>
        <span className="year-badge">{pub.year}</span>
      </div>
      <h4 className="card-title">{pub.title}</h4>
      {pub.authors?.length > 0 && (
        <p className="card-authors">{pub.authors.slice(0, 3).join(', ')}{pub.authors.length > 3 ? ' et al.' : ''}</p>
      )}
      <p className={`card-abstract ${expanded ? 'expanded' : ''}`}>{pub.abstract}</p>
      {pub.abstract?.length > 120 && (
        <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
      {pub.url && (
        <a href={pub.url} target="_blank" rel="noreferrer" className="card-link">
          View paper <LinkIcon />
        </a>
      )}
    </div>
  );
}

// ── TRIAL CARD ────────────────────────────────────────────────────────────────
function TrialCard({ trial, index }) {
  const statusClass = {
    'RECRUITING': 'status-recruiting',
    'ACTIVE_NOT_RECRUITING': 'status-active',
    'COMPLETED': 'status-completed',
  }[trial.status] || 'status-other';

  return (
    <div className="card trial-card" style={{ animationDelay: `${index * 0.05}s` }}>
      <div className="card-header">
        <span className="badge badge-trial"><FlaskIcon /> Clinical Trial</span>
        <span className={`status-badge ${statusClass}`}>{trial.status?.replace(/_/g, ' ')}</span>
      </div>
      <h4 className="card-title">{trial.title}</h4>
      {trial.summary && <p className="card-abstract">{trial.summary}</p>}
      {trial.locations?.length > 0 && (
        <p className="card-meta">📍 {trial.locations.join(' · ')}</p>
      )}
      {trial.contact && <p className="card-meta">📞 {trial.contact}</p>}
      {trial.url && (
        <a href={trial.url} target="_blank" rel="noreferrer" className="card-link">
          View trial <LinkIcon />
        </a>
      )}
    </div>
  );
}

// ── MESSAGE BUBBLE ────────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      {!isUser && (
        <div className="assistant-avatar">
          <PulseIcon />
        </div>
      )}
      <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
        {isUser ? (
          <p>{msg.content}</p>
        ) : (
          <div className="assistant-content">
            <FormattedAnswer text={msg.content} />
            {msg.publications?.length > 0 && (
              <div className="results-section">
                <h3 className="results-heading"><BookIcon /> Research Publications ({msg.publications.length})</h3>
                <div className="cards-grid">
                  {msg.publications.map((pub, i) => <PublicationCard key={i} pub={pub} index={i} />)}
                </div>
              </div>
            )}
            {msg.trials?.length > 0 && (
              <div className="results-section">
                <h3 className="results-heading"><FlaskIcon /> Clinical Trials ({msg.trials.length})</h3>
                <div className="cards-grid">
                  {msg.trials.map((trial, i) => <TrialCard key={i} trial={trial} index={i} />)}
                </div>
              </div>
            )}
            {msg.sources_used > 0 && (
              <p className="sources-note">Analyzed {msg.sources_used} sources from PubMed, OpenAlex & ClinicalTrials.gov</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── FORMATTED ANSWER ──────────────────────────────────────────────────────────
function FormattedAnswer({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div className="formatted-answer">
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**')) {
          return <h4 key={i} className="answer-heading">{line.replace(/\*\*/g, '')}</h4>;
        }
        if (line.startsWith('**')) {
          const parts = line.split('**');
          return <p key={i}>{parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}</p>;
        }
        if (line.startsWith('*') || line.startsWith('-')) {
          return <li key={i}>{line.replace(/^[*-]\s*/, '')}</li>;
        }
        if (line.trim() === '') return <br key={i} />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

// ── SETUP MODAL ───────────────────────────────────────────────────────────────
function SetupModal({ onStart }) {
  const [form, setForm] = useState({ patientName: '', disease: '', location: '', query: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.disease || !form.query) return;
    onStart(form);
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-logo">
          <PulseIcon />
          <span>CuraLink</span>
        </div>
        <h2 className="modal-title">Medical Research Assistant</h2>
        <p className="modal-subtitle">AI-powered research backed by PubMed, OpenAlex & ClinicalTrials.gov</p>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label>Your Name <span className="optional">(optional)</span></label>
            <input
              type="text"
              placeholder="e.g. John Smith"
              value={form.patientName}
              onChange={e => setForm({ ...form, patientName: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Disease / Condition <span className="required">*</span></label>
            <input
              type="text"
              placeholder="e.g. Parkinson's disease, lung cancer..."
              value={form.disease}
              onChange={e => setForm({ ...form, disease: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Location <span className="optional">(optional)</span></label>
            <input
              type="text"
              placeholder="e.g. Toronto, Canada"
              value={form.location}
              onChange={e => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Your Research Question <span className="required">*</span></label>
            <textarea
              placeholder="e.g. Latest treatments for deep brain stimulation..."
              value={form.query}
              onChange={e => setForm({ ...form, query: e.target.value })}
              required
              rows={3}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={!form.disease || !form.query}>
            Start Research Session
          </button>
        </form>
        <div className="modal-examples">
          <p className="examples-label">Try these:</p>
          {[
            ['Lung cancer', 'Latest treatment options'],
            ['Diabetes', 'Clinical trials for Type 2'],
            ["Alzheimer's", 'Recent drug research'],
          ].map(([d, q]) => (
            <button key={d} className="example-chip" onClick={() => setForm({ ...form, disease: d, query: q })}>
              {d}: {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [sessionId] = useState(generateSessionId);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState(null);
  const [showSetup, setShowSetup] = useState(true);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const startSession = useCallback(async (form) => {
    setContext(form);
    setShowSetup(false);

    try {
      await fetch(`${API_BASE}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...form })
      });
    } catch (err) {
      console.error('Session init error:', err);
    }

    sendQuery(form.query, form);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, loading, sessionId]);

  const sendQuery = useCallback(async (queryText, ctx = context) => {
    if (!queryText?.trim() || loading || !ctx) return;

    const userMsg = { role: 'user', content: queryText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const resp = await fetch(`${API_BASE}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          disease: ctx.disease,
          query: queryText,
          location: ctx.location,
          patientName: ctx.patientName
        })
      });

      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      const assistantMsg = {
        role: 'assistant',
        content: data.answer,
        publications: data.publications || [],
        trials: data.clinical_trials || [],
        sources_used: data.sources_used || 0
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I encountered an error: ${err.message}. Please try again.`,
        publications: [],
        trials: [],
        sources_used: 0
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [context, loading, sessionId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendQuery(input);
  };

  const resetSession = () => {
    setMessages([]);
    setContext(null);
    setShowSetup(true);
    setInput('');
  };

  return (
    <div className="app">
      {showSetup && <SetupModal onStart={startSession} />}

      <header className="header">
        <div className="header-left">
          <div className="logo">
            <PulseIcon />
            <span>CuraLink</span>
          </div>
          {context && (
            <div className="context-pill">
              {context.patientName && (
                <span className="context-name"><UserIcon /> {context.patientName}</span>
              )}
              <span className="context-disease">{context.disease}</span>
              {context.location && <span className="context-location">· {context.location}</span>}
            </div>
          )}
        </div>
        <button className="btn-new-chat" onClick={resetSession}>
          <NewChatIcon /> New Session
        </button>
      </header>

      <main className="chat-area">
        {messages.length === 0 && !loading && (
          <div className="empty-state">
            <div className="empty-icon"><PulseIcon /></div>
            <h2>Ready to research{context?.patientName ? `, ${context.patientName}` : ''}</h2>
            <p>Ask anything about {context?.disease || 'your condition'}</p>
          </div>
        )}

        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}

        {loading && (
          <div className="message message-assistant">
            <div className="assistant-avatar"><PulseIcon /></div>
            <div className="bubble bubble-assistant loading-bubble">
              <SpinnerIcon />
              <span>Searching PubMed, OpenAlex & ClinicalTrials.gov...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {!showSetup && (
        <footer className="input-area">
          <form onSubmit={handleSubmit} className="input-form">
            <input
              ref={inputRef}
              className="input-field"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={`Ask a follow-up about ${context?.disease || 'your condition'}...`}
              disabled={loading}
            />
            <button type="submit" className="btn-send" disabled={!input.trim() || loading}>
              {loading ? <SpinnerIcon /> : <SendIcon />}
            </button>
          </form>
          <p className="disclaimer">For research purposes only. Not a substitute for medical advice.</p>
        </footer>
      )}
    </div>
  );
}