function Scanner({ boxName, onDone }) {
  const videoRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState("");
  const [reader] = useState(() => new BrowserMultiFormatReader());
  const stopFnRef = useRef(null);

  // === dedup & rate limit ===
  const DEDUP_WINDOW_MS = 8000;     // ignora lo stesso ISBN per 8s
  const AFTER_SEND_LOCK_MS = 1200;  // blocco “hard” dopo ogni invio
  const GLOBAL_RATE_MS = 500;       // distanza minima tra due letture qualsiasi

  const lastAnyScanRef = useRef(0);
  const lastSentAtRef   = useRef(0);
  const lastSentCodeRef = useRef("");            // ISBN normalizzato
  const recentIsbnRef   = useRef(new Map());     // isbnNormalizzato -> lastTs

  const norm = (raw) => String(raw || "").replace(/\D+/g, "");
  const isIsbn = (d) => d.length === 10 || (d.length === 13 && (d.startsWith("978") || d.startsWith("979")));

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
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = 880;
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      setTimeout(() => o.stop(), 150);
    } catch {}
  };

  const sendToSheet = async (isbnDigits) => {
    try {
      await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // niente preflight CORS
        body: JSON.stringify({ box: boxName, isbn: isbnDigits }),
      });
    } catch {}
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

          // rate limit globale
          if (now - lastAnyScanRef.current < GLOBAL_RATE_MS) return;
          lastAnyScanRef.current = now;

          // blocco duro post-invio
          if (now - lastSentAtRef.current < AFTER_SEND_LOCK_MS) return;

          const raw = (result.getText() || "").trim();
          const digits = norm(raw);
          if (!isIsbn(digits)) return; // scarta non-libro

          // dedup per ISBN normalizzato
          sweepOld(now);
          if (recentIsbnRef.current.has(digits)) return;

          // evita ripetizioni immediatamente consecutive dello stesso codice
          if (digits === lastSentCodeRef.current) return;

          // --- OK: valido e nuovo ---
          recentIsbnRef.current.set(digits, now);
          lastSentCodeRef.current = digits;
          lastSentAtRef.current = now;

          setLast(digits);
          setCount((c) => c + 1);
          beep();
          sendToSheet(digits);
        }
      );
    } catch (e) {
      alert("Impossibile avviare la fotocamera. Concedi i permessi e riprova.");
      setRunning(false);
    }
  };

  const stop = () => {
    try { stopFnRef.current?.stop(); } catch {}
    reader.reset();
    setRunning(false);
  };

  useEffect(() => () => stop(), []);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
        Scansione attiva per: {boxName}
      </h2>

      <div style={{ marginBottom: 12 }}>
        {!running ? (
          <Btn onClick={start} style={{ width: 300 }}>Avvia scansione</Btn>
        ) : (
          <Btn ghost onClick={stop} style={{ width: 300 }}>Ferma scansione</Btn>
        )}
      </div>

      <video
        ref={videoRef}
        style={{
          width: "100%", maxWidth: 640,
          borderRadius: 12, border: "1px solid #ddd", background: "#000"
        }}
        muted playsInline
      />

      <div style={{ marginTop: 12, color: "#555" }}>
        <div>Letti: <strong>{count}</strong></div>
        <div>Ultimo ISBN: <strong>{last || "—"}</strong></div>
        <div style={{ fontSize: 12, marginTop: 6 }}>
          Consiglio: allontana il libro dopo il beep ✅
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Btn ghost onClick={onDone}>Torna alla Home</Btn>
      </div>
    </div>
  );
}
