import React, { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient.js";
import { fetchBookMetadata } from "./bookApi.js";
import QRCode from "qrcode";
// Removed Google OAuth to simplify access and avoid origin errors
import { BrowserMultiFormatReader } from "@zxing/browser";

/** ===== CONFIG ===== */
// Removed Google Sheets; all writes go to Supabase

// Google OAuth removed

/** ===== UI Button ===== */
function Btn({ children, ghost, onClick, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: ghost ? "#fff" : "#2563eb",
        color: ghost ? "#111" : "#fff",
        padding: "12px 16px",
        borderRadius: 12,
        border: ghost ? "1px solid #ddd" : "none",
        boxShadow: ghost ? "none" : "0 2px 8px rgba(0,0,0,0.1)",
        width: 260,
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** ===== SCANNER ===== */
function Scanner({ boxName, onDone }) {
  const videoRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState("");
  const [reader] = useState(() => new BrowserMultiFormatReader());
  const stopFnRef = useRef(null);
  const [recentBooks, setRecentBooks] = useState([]);

  // dedup & rate limit
  const DEDUP_WINDOW_MS = 8000;
  const AFTER_SEND_LOCK_MS = 1200;
  const GLOBAL_RATE_MS = 500;

  const lastAnyScanRef = useRef(0);
  const lastSentAtRef = useRef(0);
  const lastSentCodeRef = useRef("");
  const recentIsbnRef = useRef(new Map());

  const norm = (raw) => String(raw || "").replace(/\D+/g, "");
  const isIsbn = (d) =>
    d.length === 10 ||
    (d.length === 13 &&
      (d.startsWith("978") || d.startsWith("979")));

  const sweepOld = (now) => {
    for (const [code, t] of recentIsbnRef.current.entries()) {
      if (now - t > DEDUP_WINDOW_MS) recentIsbnRef.current.delete(code);
    }
  };

  const beep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = 880;
      o.start();
      g.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + 0.15
      );
      setTimeout(() => o.stop(), 150);
    } catch {}
  };

  const sendToSupabase = async (isbnDigits) => {
    try {
      // Ensure box exists and get its id
      let boxId = null;
      if (boxName) {
        const { data: found, error: findErr } = await supabase
          .from('boxes')
          .select('id')
          .eq('name', boxName)
          .maybeSingle();
        if (!findErr && found) {
          boxId = found.id;
        } else {
          const { data: up, error: upErr } = await supabase
            .from('boxes')
            .upsert({ name: boxName }, { onConflict: 'name' })
            .select('id')
            .single();
          if (upErr) throw upErr;
          boxId = up.id;
        }
      }
      const meta = await fetchBookMetadata(isbnDigits);
      const { error } = await supabase
        .from("books")
        .insert({
          box_id: boxId,
          isbn: isbnDigits,
          title: meta.title || "",
          author: meta.author || "",
          year: meta.year ? Number(meta.year) : null,
          genre: meta.genre || "",
          cover: meta.cover || null,
          plot: meta.plot || "",
        });
      if (error) throw error;
      // Optimistically update local recent list
      setRecentBooks((prev) => [
        {
          boxes: { name: boxName },
          isbn: isbnDigits,
          title: meta.title || "",
          author: meta.author || "",
          year: meta.year ? Number(meta.year) : null,
          genre: meta.genre || "",
          cover: meta.cover || null,
          marketPrice: null,
          priceSource: null,
          plot: meta.plot || "",
          created_at: new Date().toISOString(),
        },
        ...(prev || []),
      ].slice(0, 10));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("DB insert failed", e);
      alert(`Salvataggio fallito: ${e?.message || e?.hint || 'Controlla policy e colonne'}`);
    }
  };

  const start = async () => {
    if (running) return;
    setRunning(true);
    try {
      stopFnRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        async (result) => {
          const now = Date.now();
          if (!result) return;

          if (now - lastAnyScanRef.current < GLOBAL_RATE_MS) return;
          lastAnyScanRef.current = now;

          if (now - lastSentAtRef.current < AFTER_SEND_LOCK_MS) return;

          const raw = (result.getText() || "").trim();
          const digits = norm(raw);
          if (!isIsbn(digits)) return;

          sweepOld(now);
          if (recentIsbnRef.current.has(digits)) return;
          if (digits === lastSentCodeRef.current) return;

          recentIsbnRef.current.set(digits, now);
          lastSentCodeRef.current = digits;
          lastSentAtRef.current = now;

          setLast(digits);
          setCount((c) => c + 1);
          beep();
          sendToSupabase(digits);
        }
      );
    } catch (e) {
      alert(
        "Impossibile avviare la fotocamera. Concedi i permessi e riprova."
      );
      setRunning(false);
    }
  };

  const stop = () => {
    try {
      if (stopFnRef.current && typeof stopFnRef.current.stop === 'function') {
        stopFnRef.current.stop();
      }
    } catch {}
    try {
      if (reader && typeof reader.reset === 'function') {
        reader.reset();
      }
    } catch {}
    setRunning(false);
  };

  useEffect(() => () => stop(), []);

  // Load and subscribe to recent books for this box
  useEffect(() => {
    let subscription;
    const loadRecent = async () => {
      try {
        const res = await supabase
          .from('books')
          .select('id, created_at, isbn, title, boxes(name)')
          .eq('boxes.name', boxName)
          .order('created_at', { ascending: false })
          .limit(10);
        if (res.error) throw res.error;
        setRecentBooks(res.data || []);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Impossibile caricare le ultime scansioni', err);
        alert('Impossibile caricare le ultime scansioni');
      }
    };
    if (boxName) {
      loadRecent();
      try {
        subscription = supabase
          .channel(`books-inserts-${boxName}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'books' }, (payload) => {
            if (payload?.new) {
              setRecentBooks((prev) => [payload.new, ...(prev || [])].slice(0, 10));
            }
          })
          .subscribe();
      } catch {}
    }
    return () => {
      try { subscription && supabase.removeChannel(subscription); } catch {}
    };
  }, [boxName]);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", textAlign: "center" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
        Scansione attiva per: {boxName}
      </h2>

      <div style={{ marginBottom: 12, display: 'flex', gap: 12, justifyContent: 'center' }}>
        {!running ? (
          <Btn onClick={start} style={{ width: 300 }}>
            Avvia scansione
          </Btn>
        ) : (
          <Btn ghost onClick={stop} style={{ width: 300 }}>
            Ferma scansione
          </Btn>
        )}
        <Btn ghost onClick={() => { stop(); onDone(); }} style={{ width: 300 }}>
          Torna alla Home
        </Btn>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <video
          ref={videoRef}
          style={{
            width: "100%",
            maxWidth: 640,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "#000",
          }}
          muted
          playsInline
        />
      </div>

      <div style={{ marginTop: 16, textAlign: 'left', maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Ultime scansioni</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {(recentBooks || []).map((b, idx) => (
            <li key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <div style={{ fontWeight: 600 }}>{b.title || 'Senza titolo'}</div>
              <div style={{ color: '#666', fontSize: 12 }}>{b.isbn} • {(b.created_at || '').slice(0,10)}</div>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 12, color: "#555" }}>
        <div>
          Letti: <strong>{count}</strong>
        </div>
        <div>
          Ultimo ISBN: <strong>{last || "—"}</strong>
        </div>
        <div style={{ fontSize: 12, marginTop: 6 }}>
          Consiglio: allontana il libro dopo il beep ✅
        </div>
      </div>

      {/* Removed duplicate bottom Home button */}
    </div>
  );
}

/** ===== APP ROOT ===== */
function App() {
  // Google OAuth removed
  const [boxName, setBoxName] = useState("");
  const [step, setStep] = useState("home");
  const [books, setBooks] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [boxesOptions, setBoxesOptions] = useState([]);
  const [boxesList, setBoxesList] = useState([]);
  const [selectedBox, setSelectedBox] = useState("");
  const [qrBoxName, setQrBoxName] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [expandedBoxes, setExpandedBoxes] = useState(new Set());

  // Login removed

  const handleStartScan = () => {
    const target = (selectedBox || boxName || "").trim();
    if (!target) {
      alert("Seleziona o inserisci una scatola");
      return;
    }
    setBoxName(target);
    setStep("scanner");
  };

  useEffect(() => {
    const loadBoxes = async () => {
      try {
        const { data, error } = await supabase.from('boxes').select('name').order('name');
        if (error) throw error;
        const names = (data || []).map(b => b.name).filter(Boolean);
        setBoxesOptions(names);
        setBoxesList(names);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Load boxes failed', err);
        alert('Impossibile caricare le scatole');
        setBoxesOptions([]);
        setBoxesList([]);
      }
    };
    if (step === 'start' || step === 'boxes') {
      loadBoxes();
    }
  }, [step]);

  const generateQrForBox = async (name) => {
    try {
      const base = window.location.origin;
      const url = `${base}?box=${encodeURIComponent(name)}&view=books`;
      const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 1 });
      setQrBoxName(name);
      setQrDataUrl(dataUrl);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('QR generation failed', err);
      alert('Impossibile generare il QR code');
    }
  };

  // Auto-select box from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const boxParam = params.get('box');
    const viewParam = params.get('view');
    if (boxParam) {
      setSelectedBox(boxParam);
      if (viewParam === 'books') {
        setStep('books');
      }
    }
  }, []);

  // Live auto-refresh: when on Registered Lists, fetch and subscribe to inserts
  useEffect(() => {
    if (step !== 'books') return;
    let subscription;
    const load = async () => {
      const { data } = await supabase
        .from('books')
        .select('*')
        .order('created_at', { ascending: false });
      setBooks(data || []);
    };
    load();
    try {
      subscription = supabase
        .channel('books-inserts')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'books' },
          (payload) => {
            setBooks((prev) => [payload.new, ...(prev || [])]);
          }
        )
        .subscribe();
    } catch {}
    return () => {
      try { subscription && supabase.removeChannel(subscription); } catch {}
    };
  }, [step]);

  return (
    <>
      <main style={{ minHeight: "100vh", background: "#fff", padding: 24 }}>
        {step === "home" && (
          <div className="relative flex min-h-screen flex-col bg-white justify-between overflow-x-hidden" style={{fontFamily: 'Manrope, "Noto Sans", sans-serif'}}>
            <div>
              <div className="flex items-center bg-white p-4 pb-2 justify-between">
                <h2 className="text-[#111418] text-lg font-bold leading-tight tracking-[-0.015em] flex-1 text-center pl-12">Book Manager</h2>
                <div className="flex w-12 items-center justify-end" />
              </div>
              <div className="flex justify-center">
                <div className="flex flex-1 gap-3 max-w-[480px] flex-col items-stretch px-4 py-3">
                  <button
                    className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-5 bg-[#0d78f2] text-white text-base font-bold leading-normal tracking-[0.015em] w-full"
                    onClick={() => setStep('start')}
                  >
                    <span className="truncate">Start Scanning</span>
                  </button>
                  <button
                    className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-5 bg-[#f0f2f5] text-[#111418] text-base font-bold leading-normal tracking-[0.015em] w-full"
                    onClick={async () => {
                      try {
                        const { data, error } = await supabase
                          .from('books')
                          .select('*, boxes(name)')
                          .order('created_at', { ascending: false });
                        if (error) throw error;
                        setBooks(data || []);
                        setStep('books');
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error('Load books failed', err);
                        alert('Impossibile caricare i libri. Verifica la tabella e le policy in Supabase.');
                      }
                    }}
                  >
                    <span className="truncate">Registered Lists</span>
                  </button>
                  <button
                    className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-5 bg-[#f0f2f5] text-[#111418] text-base font-bold leading-normal tracking-[0.015em] w-full"
                    onClick={async () => {
                      const { data } = await supabase.from('books').select('box').order('box')
                      const boxes = Array.from(new Set((data || []).map(b => b.box))).filter(Boolean)
                      setBooks(boxes.map(name => ({ box: name })))
                      setStep('boxes')
                    }}
                  >
                    <span className="truncate">Created Boxes</span>
                  </button>
                </div>
              </div>
            </div>
            <div><div className="h-5 bg-white"></div></div>
          </div>
        )}

        {step === "start" && (
          <div className="relative flex min-h-screen flex-col bg-white justify-between overflow-x-hidden" style={{fontFamily: 'Manrope, "Noto Sans", sans-serif'}}>
            <div>
              <div className="flex items-center bg-white p-4 pb-2 justify-between">
                <button className="text-[#111418] flex size-12 shrink-0 items-center" onClick={() => setStep('home')} aria-label="Back">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"></path></svg>
                </button>
                <h2 className="text-[#111418] text-lg font-bold leading-tight tracking-[-0.015em] flex-1 text-center pr-12">Add Book</h2>
              </div>
              <div className="flex max-w-[480px] flex-wrap items-end gap-4 px-4 py-3">
                <label className="flex flex-col min-w-40 flex-1">
                  <select
                    className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-[#111418] focus:outline-0 focus:ring-0 border-none bg-[#f0f2f5] focus:border-none h-14 bg-[image:var(--select-button-svg)] placeholder:text-[#60748a] p-4 text-base font-normal leading-normal"
                    value={selectedBox}
                    onChange={(e) => setSelectedBox(e.target.value)}
                  >
                    <option value="">Select Box</option>
                    {boxesOptions.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex max-w-[480px] flex-wrap items-end gap-4 px-4 py-1">
                <label className="flex flex-col min-w-40 flex-1">
                  <input
                    placeholder="Or type a new box name"
                    className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-[#111418] focus:outline-0 focus:ring-0 border-none bg-[#f0f2f5] focus:border-none h-14 placeholder:text-[#60748a] p-4 text-base font-normal leading-normal"
                    value={selectedBox}
                    onChange={(e) => setSelectedBox(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex px-4 py-3 justify-start">
                <button
                  className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-10 px-4 bg-[#f0f2f5] text-[#111418] gap-2 pl-4 text-sm font-bold leading-normal tracking-[0.015em]"
                  onClick={handleStartScan}
                >
                  <div className="text-[#111418]" aria-hidden>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M232,48V88a8,8,0,0,1-16,0V56H184a8,8,0,0,1,0-16h40A8,8,0,0,1,232,48ZM72,200H40V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H72a8,8,0,0,0,0-16Zm152-40a8,8,0,0,0-8,8v32H184a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V168A8,8,0,0,0,224,160ZM32,96a8,8,0,0,0,8-8V56H72a8,8,0,0,0,0-16H32a8,8,0,0,0-8,8V88A8,8,0,0,0,32,96ZM80,80a8,8,0,0,0-8,8v80a8,8,0,0,0,16,0V88A8,8,0,0,0,80,80Zm104,88V88a8,8,0,0,0-16,0v80a8,8,0,0,0,16,0ZM144,80a8,8,0,0,0-8,8v80a8,8,0,0,0,16,0V88A8,8,0,0,0,144,80Zm-32,0a8,8,0,0,0-8,8v80a8,8,0,0,0,16,0V88A8,8,0,0,0,112,80Z"></path></svg>
                  </div>
                  <span className="truncate">Scan ISBN</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "scanner" && (
          <Scanner boxName={boxName} onDone={() => setStep("home")} />
        )}

        {step === 'books' && (
          <div className="relative flex min-h-screen flex-col bg-white justify-between overflow-x-hidden" style={{fontFamily: 'Manrope, "Noto Sans", sans-serif'}}>
            <div>
              <div className="flex items-center bg-white p-4 pb-2 justify-between">
                <button className="text-[#111418] flex size-12 shrink-0 items-center" onClick={() => setStep('home')} aria-label="Back">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"></path></svg>
                </button>
                <h2 className="text-[#111418] text-lg font-bold leading-tight tracking-[-0.015em] flex-1 text-center">My Books</h2>
                <div className="w-12" />
              </div>
              {(() => {
                const groups = (books || []).reduce((acc, b) => {
                  const k = (b.boxes && b.boxes.name) || '—';
                  (acc[k] = acc[k] || []).push(b);
                  return acc;
                }, {});
                const order = Object.keys(groups).sort((a, b) => a.localeCompare(b));
                return order.map((box) => (
                  <div key={box}>
                    <div 
                      className="flex items-center justify-between px-4 py-3 cursor-pointer border-b border-[#eee]"
                      onClick={() => {
                        const newExpanded = new Set(expandedBoxes);
                        if (newExpanded.has(box)) {
                          newExpanded.delete(box);
                        } else {
                          newExpanded.add(box);
                        }
                        setExpandedBoxes(newExpanded);
                      }}
                    >
                      <h3 className="text-[#111418] text-lg font-bold leading-tight tracking-[-0.015em]">{box}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[#60748a] text-sm">({groups[box].length} libri)</span>
                        <button
                          className="text-[#60748a] text-sm px-2 py-1 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            generateQrForBox(box);
                          }}
                        >
                          QR
                        </button>
                        <span className="text-[#60748a] text-lg">
                          {expandedBoxes.has(box) ? '▼' : '▶'}
                        </span>
                      </div>
                    </div>
                    {expandedBoxes.has(box) && (
                      <div>
                        {groups[box]
                          .slice()
                          .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
                          .map((item, idx) => (
                            <div key={idx} className="flex items-center gap-4 bg-white px-4 min-h-[72px] py-2 justify-between cursor-pointer border-b border-[#f0f0f0]" onClick={() => { setSelectedBook(item); setStep('detail'); }}>
                              <div className="flex flex-col justify-center">
                                <p className="text-[#111418] text-base font-medium leading-normal line-clamp-1">{item.title || 'Senza titolo'}</p>
                                <p className="text-[#60748a] text-sm font-normal leading-normal line-clamp-2">{item.author || '—'}</p>
                              </div>
                              <div className="shrink-0"><p className="text-[#60748a] text-sm font-normal leading-normal">{(item.created_at || '').slice(0,10) || '—'}</p></div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ));
              })()}
              {qrDataUrl && (
                <div className="px-4 py-4 border-t border-[#eee]">
                  <div className="text-sm text-[#60748a] mb-2">QR Code per: {qrBoxName}</div>
                  <img src={qrDataUrl} alt={`QR ${qrBoxName}`} style={{ width: 200, height: 200 }} />
                  <div className="text-xs text-[#60748a] mt-2">Scansiona per aprire il catalogo di questa scatola</div>
                </div>
              )}
            </div>
            <div><div className="h-5 bg-white"></div></div>
          </div>
        )}

        {step === 'boxes' && (
          <div className="relative flex min-h-screen flex-col bg-white justify-between overflow-x-hidden" style={{fontFamily: 'Manrope, "Noto Sans", sans-serif'}}>
            <div>
              <div className="flex items-center bg-white p-4 pb-2 justify-between">
                <button className="text-[#111418] flex size-12 shrink-0 items-center" onClick={() => setStep('home')} aria-label="Back">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"></path></svg>
                </button>
                <h2 className="text-[#111418] text-lg font-bold leading-tight tracking-[-0.015em] flex-1 text-center">Boxes</h2>
                <div className="w-12" />
              </div>
              <div className="px-4 py-2">
                <div className="flex gap-2">
                  <input
                    className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-[#111418] focus:outline-0 focus:ring-0 border-none bg-[#f0f2f5] focus:border-none h-12 placeholder:text-[#60748a] p-3 text-base font-normal leading-normal"
                    placeholder="New box name"
                    value={selectedBox}
                    onChange={(e) => setSelectedBox(e.target.value)}
                  />
                  <button
                    className="flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-4 bg-[#0d78f2] text-white text-base font-bold leading-normal tracking-[0.015em]"
                    onClick={async () => {
                      try {
                        const name = (selectedBox || '').trim();
                        if (!name) return;
                        const { error } = await supabase
                          .from('boxes')
                          .upsert({ name }, { onConflict: 'name' });
                        if (error) throw error;
                        setSelectedBox('');
                        const { data: refresh, error: refErr } = await supabase.from('boxes').select('name').order('name');
                        if (refErr) throw refErr;
                        setBoxesList((refresh || []).map(b => b.name));
                        alert('Scatola creata/aggiornata');
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error('Create box failed', err);
                        alert('Impossibile creare la scatola');
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
              <ul className="px-4">
                {(boxesList || []).map((name, idx) => (
                  <li key={idx} className="py-2 border-b border-[#eee] flex items-center justify-between gap-2">
                    <span>{name}</span>
                    <button
                      className="flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-10 px-3 bg-[#f0f2f5] text-[#111418] text-sm font-bold leading-normal tracking-[0.015em]"
                      onClick={() => generateQrForBox(name)}
                    >
                      QR Code
                    </button>
                  </li>
                ))}
              </ul>
              {qrDataUrl && (
                <div className="px-4 py-4">
                  <div className="text-sm text-[#60748a] mb-2">QR per: {qrBoxName}</div>
                  <img src={qrDataUrl} alt={`QR ${qrBoxName}`} style={{ width: 256, height: 256 }} />
                </div>
              )}
            </div>
            <div><div className="h-5 bg-white"></div></div>
          </div>
        )}

        {step === 'detail' && selectedBook && (
          <div className="relative flex min-h-screen flex-col bg-white justify-between overflow-x-hidden" style={{fontFamily: 'Manrope, "Noto Sans", sans-serif'}}>
            <div>
              <div className="flex items-center bg-white p-4 pb-2 justify-between">
                <button className="text-[#111418] flex size-12 shrink-0 items-center" onClick={() => setStep('books')} aria-label="Back">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"></path></svg>
                </button>
                <h2 className="text-[#111418] text-lg font-bold leading-tight tracking-[-0.015em] flex-1 text-center pr-12">Book Details</h2>
              </div>
              <div className="@container">
                <div className="@[480px]:px-4 @[480px]:py-3">
                  <div
                    className="w-full bg-center bg-no-repeat bg-cover flex flex-col justify-end overflow-hidden bg-white @[480px]:rounded-lg min-h-[218px]"
                    style={{ backgroundImage: `url('${selectedBook.cover || ''}')` }}
                  ></div>
                </div>
              </div>
              <h1 className="text-[#111418] text-[22px] font-bold leading-tight tracking-[-0.015em] px-4 text-left pb-3 pt-5">{selectedBook.title || 'Untitled'}</h1>
              <p className="text-[#111418] text-base font-normal leading-normal pb-3 pt-1 px-4">By {selectedBook.author || 'Unknown'} {selectedBook.year ? `(${selectedBook.year})` : ''}</p>
              <p className="text-[#111418] text-base font-normal leading-normal pb-3 pt-1 px-4">Genre: {selectedBook.genre || '—'}</p>
              <p className="text-[#111418] text-base font-normal leading-normal pb-3 pt-1 px-4 whitespace-pre-wrap">{selectedBook.plot ? `Plot: ${selectedBook.plot}` : 'Plot: —'}</p>
              <p className="text-[#111418] text-base font-normal leading-normal pb-3 pt-1 px-4">Market Price: {selectedBook.marketPrice ? `€ ${selectedBook.marketPrice}` : '—'}</p>
              {selectedBook.priceSource ? (
                <a className="text-[#60748a] text-sm font-normal leading-normal pb-3 pt-1 px-4 underline" href={selectedBook.priceSource} target="_blank" rel="noreferrer">Price Source: View</a>
              ) : (
                <p className="text-[#60748a] text-sm font-normal leading-normal pb-3 pt-1 px-4">Price Source: —</p>
              )}
            </div>
            <div>
              <div className="flex px-4 py-3">
                <button
                  className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-5 flex-1 bg-[#0d78f2] text-white text-base font-bold leading-normal tracking-[0.015em]"
                  onClick={() => setStep('books')}
                >
                  <span className="truncate">Add to Collection</span>
                </button>
              </div>
              <div className="h-5 bg-white"></div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default App;
