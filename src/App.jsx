import { useState, useRef } from "react";
import { RotateCcw, Undo2, Move, Eye, EyeOff, Plus, Minus } from "lucide-react";

// ---------------------------------------------------------------------------
// ピッチ上のゾーン定義(700x450, 右方向に攻撃)- 初期配置のばらけさせに使用
// ---------------------------------------------------------------------------
const ZONES = {
  DEEP: { x: [50, 150], y: [170, 280], label: "自陣" },
  MID_CENTER: { x: [330, 450], y: [190, 260], label: "中盤中央" },
  MID_SUPPORT: { x: [380, 470], y: [270, 340], label: "中盤(後方支援)" },
  WIDE_TOP_DEEP: { x: [210, 310], y: [40, 110], label: "サイド深め(上)" },
  WIDE_BOTTOM_DEEP: { x: [210, 310], y: [340, 410], label: "サイド深め(下)" },
  WIDE_BOTTOM_HIGH: { x: [520, 610], y: [330, 410], label: "サイド高め(下)" },
  BOX: { x: [560, 620], y: [195, 255], label: "ペナルティエリア" },
  DEF_CENTER: { x: [390, 510], y: [170, 300], label: "" },
};

const OFFENSE_ZONE_KEYS = ["DEEP", "MID_CENTER", "MID_SUPPORT", "WIDE_TOP_DEEP", "WIDE_BOTTOM_DEEP", "WIDE_BOTTOM_HIGH"];
const GENERIC_OFFENSE_ZONE = { x: [60, 620], y: [40, 410] };
const DEF_ZONE = { x: [340, 660], y: [50, 400] };
const GOAL_POINT = { x: 686, y: 225 };
const TAP_THRESHOLD = 14;
const MIN_OFFENSE = 1;
const MIN_DEFENSE = 0;
const MAX_PLAYERS = 10;
const BLOCK_RADIUS = 24;

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function distPointToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return Math.hypot(p.x - cx, p.y - cy);
}

function findBlockingDefender(from, to, defenders, radius = BLOCK_RADIUS) {
  return defenders.find((d) => distPointToSegment(d, from, to) < radius) || null;
}

function placeInZone(zone, existingPoints, tries = 25, minDist = 50) {
  let best = null;
  let bestScore = -1;
  for (let t = 0; t < tries; t++) {
    const p = {
      x: zone.x[0] + Math.random() * (zone.x[1] - zone.x[0]),
      y: zone.y[0] + Math.random() * (zone.y[1] - zone.y[0]),
    };
    const minD = existingPoints.length === 0 ? 9999 : Math.min(...existingPoints.map((e) => Math.hypot(e.x - p.x, e.y - p.y)));
    if (minD >= minDist) return p;
    if (minD > bestScore) {
      bestScore = minD;
      best = p;
    }
  }
  return best;
}

function makeZigzag(from, to, segments = 6, amp = 12) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const bx = from.x + dx * t;
    const by = from.y + dy * t;
    const side = i % 2 === 0 ? 1 : -1;
    const edge = i === 0 || i === segments ? 0 : 1;
    pts.push(`${bx + px * amp * side * edge},${by + py * amp * side * edge}`);
  }
  return pts.join(" ");
}

function freshTokens(offenseCount = 6, defenseCount = 2) {
  const points = [GOAL_POINT];
  const offense = Array.from({ length: offenseCount }).map((_, i) => {
    const zone = i < OFFENSE_ZONE_KEYS.length ? ZONES[OFFENSE_ZONE_KEYS[i]] : GENERIC_OFFENSE_ZONE;
    const pt = placeInZone(zone, points);
    points.push(pt);
    return { id: uid("off"), x: pt.x, y: pt.y, isDefender: false };
  });
  const defenders = Array.from({ length: defenseCount }).map(() => {
    const pt = placeInZone(DEF_ZONE, points, 25, 45);
    points.push(pt);
    return { id: uid("def"), x: pt.x, y: pt.y, isDefender: true };
  });
  return [...offense, ...defenders];
}

// ---------------------------------------------------------------------------
// メインアプリ
// ---------------------------------------------------------------------------
export default function App() {
  const [tokens, setTokens] = useState(() => freshTokens());
  const [arrows, setArrows] = useState([]);
  const [carrierId, setCarrierId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [playName, setPlayName] = useState("");
  const [showLabels, setShowLabels] = useState(false);
  const [blockedFlash, setBlockedFlash] = useState(null);

  const svgRef = useRef(null);
  const dragOriginRef = useRef(null);
  const arrowCounter = useRef(0);
  const blockTimerRef = useRef(null);

  function flashBlocked(from, to, defender) {
    clearTimeout(blockTimerRef.current);
    setBlockedFlash({ from, to, defender });
    blockTimerRef.current = setTimeout(() => setBlockedFlash(null), 1050);
  }

  function toSvgPoint(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = 700 / rect.width;
    const scaleY = 450 / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function updateTokenPos(id, pos) {
    setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, x: pos.x, y: pos.y } : t)));
  }

  function addArrow(arrow) {
    arrowCounter.current += 1;
    setArrows((a) => [...a, { ...arrow, id: `arrow-${arrowCounter.current}` }]);
  }

  function handlePointerDown(token, e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOriginRef.current = { x: token.x, y: token.y };
    setDraggingId(token.id);
  }

  function handlePointerMove(e) {
    if (!draggingId) return;
    const pt = toSvgPoint(e);
    updateTokenPos(draggingId, pt);
  }

  function handlePointerUp() {
    if (!draggingId) return;
    const token = tokens.find((t) => t.id === draggingId);
    const origin = dragOriginRef.current;
    const dist = Math.hypot(token.x - origin.x, token.y - origin.y);

    if (dist < TAP_THRESHOLD) {
      updateTokenPos(draggingId, origin); // 誤差を吸収してタップ扱いに
      handleTapToken({ ...token, x: origin.x, y: origin.y });
    } else if (!token.isDefender) {
      const kind = carrierId === draggingId ? "dribble" : "run";
      if (kind === "dribble") {
        const defenders = tokens.filter((t) => t.isDefender);
        const blocker = findBlockingDefender(origin, { x: token.x, y: token.y }, defenders);
        if (blocker) {
          updateTokenPos(draggingId, origin); // 相手に重なるので元の位置に戻す
          flashBlocked(origin, { x: token.x, y: token.y }, blocker);
          setDraggingId(null);
          dragOriginRef.current = null;
          return;
        }
      }
      addArrow({ kind, from: origin, to: { x: token.x, y: token.y }, tokenId: draggingId });
    }
    setDraggingId(null);
    dragOriginRef.current = null;
  }

  function handleTapToken(token) {
    if (token.isDefender) return;
    if (carrierId === null) {
      setCarrierId(token.id);
      return;
    }
    if (carrierId === token.id) return;
    const fromToken = tokens.find((t) => t.id === carrierId);
    const from = { x: fromToken.x, y: fromToken.y };
    const to = { x: token.x, y: token.y };
    const defenders = tokens.filter((t) => t.isDefender);
    const blocker = findBlockingDefender(from, to, defenders);
    if (blocker) {
      flashBlocked(from, to, blocker);
      return;
    }
    addArrow({ kind: "pass", from, to, tokenId: token.id, fromTokenId: carrierId });
    setCarrierId(token.id);
  }

  function handleGoalTap() {
    if (carrierId === null) return;
    const fromToken = tokens.find((t) => t.id === carrierId);
    if (!fromToken) return;
    const from = { x: fromToken.x, y: fromToken.y };
    const defenders = tokens.filter((t) => t.isDefender);
    const blocker = findBlockingDefender(from, GOAL_POINT, defenders);
    if (blocker) {
      flashBlocked(from, GOAL_POINT, blocker);
      return;
    }
    addArrow({ kind: "shot", from, to: GOAL_POINT, fromTokenId: carrierId });
    setCarrierId(null);
  }

  function undoLast() {
    setArrows((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.kind === "run" || last.kind === "dribble") {
        updateTokenPos(last.tokenId, last.from);
      }
      if (last.kind === "pass" || last.kind === "shot") {
        setCarrierId(last.fromTokenId);
      }
      return prev.slice(0, -1);
    });
  }

  function resetAll() {
    const offenseCount = tokens.filter((t) => !t.isDefender).length;
    const defenseCount = tokens.filter((t) => t.isDefender).length;
    setTokens(freshTokens(offenseCount, defenseCount));
    setArrows([]);
    setCarrierId(null);
    setDraggingId(null);
  }

  function addPlayer(isDefender) {
    const group = tokens.filter((t) => t.isDefender === isDefender);
    if (group.length >= MAX_PLAYERS) return;
    const points = tokens.map((t) => ({ x: t.x, y: t.y })).concat([GOAL_POINT]);
    let pt;
    if (isDefender) {
      pt = placeInZone(DEF_ZONE, points, 25, 45);
    } else {
      const zone = group.length < OFFENSE_ZONE_KEYS.length ? ZONES[OFFENSE_ZONE_KEYS[group.length]] : GENERIC_OFFENSE_ZONE;
      pt = placeInZone(zone, points);
    }
    setTokens((ts) => [...ts, { id: uid(isDefender ? "def" : "off"), x: pt.x, y: pt.y, isDefender }]);
  }

  function removePlayer(isDefender) {
    const group = tokens.filter((t) => t.isDefender === isDefender);
    const min = isDefender ? MIN_DEFENSE : MIN_OFFENSE;
    if (group.length <= min) return;
    const removeId = group[group.length - 1].id;
    setTokens((ts) => ts.filter((t) => t.id !== removeId));
    if (carrierId === removeId) setCarrierId(null);
    if (draggingId === removeId) setDraggingId(null);
  }

  const offenseCount = tokens.filter((t) => !t.isDefender).length;
  const defenseCount = tokens.filter((t) => t.isDefender).length;
  const carrierToken = tokens.find((t) => t.id === carrierId);
  const ballPos = draggingId && draggingId === carrierId ? tokens.find((t) => t.id === draggingId) : carrierToken;
  const stripes = 8;
  const stripeW = 660 / stripes;

  return (
    <div className="min-h-screen bg-emerald-950 p-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-3">
          <div className="inline-flex items-center gap-2 text-amber-400 text-xs font-bold tracking-widest uppercase mb-1">
            Free Tactics Board
          </div>
          <h1 className="text-2xl font-black text-stone-100 italic tracking-tight">戦術ボード</h1>
          <input
            value={playName}
            onChange={(e) => setPlayName(e.target.value)}
            placeholder="このプレーの名前を入力(任意)"
            className="mt-2 w-full bg-emerald-900 border border-emerald-800 rounded-lg px-3 py-2 text-sm text-stone-100 placeholder-emerald-500 focus:outline-none focus:ring-2 focus:ring-amber-400 text-center"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-emerald-900 border border-emerald-800 rounded-xl px-3 py-2 flex items-center justify-between">
            <span className="text-stone-100 text-sm font-bold flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> 味方 {offenseCount}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => removePlayer(false)} disabled={offenseCount <= MIN_OFFENSE} className="w-7 h-7 flex items-center justify-center bg-emerald-800 disabled:opacity-30 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400">
                <Minus size={14} />
              </button>
              <button onClick={() => addPlayer(false)} disabled={offenseCount >= MAX_PLAYERS} className="w-7 h-7 flex items-center justify-center bg-emerald-800 disabled:opacity-30 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400">
                <Plus size={14} />
              </button>
            </div>
          </div>
          <div className="bg-emerald-900 border border-emerald-800 rounded-xl px-3 py-2 flex items-center justify-between">
            <span className="text-stone-100 text-sm font-bold flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-stone-400 inline-block" /> 相手 {defenseCount}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => removePlayer(true)} disabled={defenseCount <= MIN_DEFENSE} className="w-7 h-7 flex items-center justify-center bg-emerald-800 disabled:opacity-30 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400">
                <Minus size={14} />
              </button>
              <button onClick={() => addPlayer(true)} disabled={defenseCount >= MAX_PLAYERS} className="w-7 h-7 flex items-center justify-center bg-emerald-800 disabled:opacity-30 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400">
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 text-xs text-emerald-300 mb-2">
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 bg-amber-400" /> パス(タップ)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-0 border-t-2 border-dashed border-stone-100" /> ラン(ドラッグ)
          </span>
          <span className="flex items-center gap-1">
            <Move size={12} className="text-amber-400" /> ドリブル(保持者をドラッグ)
          </span>
        </div>

        <div className="bg-emerald-900 border border-emerald-800 rounded-xl p-3 mb-3">
          <svg
            ref={svgRef}
            viewBox="0 0 700 450"
            className="w-full h-auto select-none"
            role="img"
            aria-label="戦術ボード"
            style={{ touchAction: "none" }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <defs>
              <clipPath id="freeClip">
                <rect x="20" y="20" width="660" height="410" rx="4" />
              </clipPath>
              <marker id="f-arrow-gold" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="fill-amber-400" />
              </marker>
              <marker id="f-arrow-chalk" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="fill-stone-100" />
              </marker>
              <marker id="f-arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="fill-red-400" />
              </marker>
            </defs>

            <rect x="0" y="0" width="700" height="450" className="fill-emerald-950" />
            <g clipPath="url(#freeClip)">
              <rect x="20" y="20" width="660" height="410" className="fill-emerald-900" />
              {Array.from({ length: stripes }).map((_, i) =>
                i % 2 === 0 ? <rect key={i} x={20 + i * stripeW} y="20" width={stripeW} height="410" className="fill-emerald-800" opacity="0.55" /> : null
              )}
            </g>

            <g className="stroke-stone-100" strokeWidth="2.5" fill="none" opacity="0.75">
              <rect x="20" y="20" width="660" height="410" rx="4" />
              <line x1="350" y1="20" x2="350" y2="430" strokeWidth="2" />
              <circle cx="350" cy="225" r="55" strokeWidth="2" />
              <rect x="20" y="125" width="120" height="200" strokeWidth="2" />
              <rect x="20" y="175" width="45" height="100" strokeWidth="2" />
              <rect x="560" y="125" width="120" height="200" strokeWidth="2" />
              <rect x="635" y="175" width="45" height="100" strokeWidth="2" />
              <rect x="8" y="195" width="12" height="60" strokeWidth="2" />
              <rect x="680" y="195" width="12" height="60" strokeWidth="2" />
            </g>
            <circle cx="350" cy="225" r="3" className="fill-stone-100" opacity="0.75" />

            {/* 確定した矢印の履歴 */}
            {arrows.map((a) => {
              if (a.kind === "run") {
                return <line key={a.id} x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} className="stroke-stone-100" strokeWidth="3" strokeDasharray="7 6" strokeLinecap="round" markerEnd="url(#f-arrow-chalk)" />;
              }
              if (a.kind === "dribble") {
                return <polyline key={a.id} points={makeZigzag(a.from, a.to)} fill="none" className="stroke-amber-400" strokeWidth="3" strokeDasharray="1 9" strokeLinecap="round" markerEnd="url(#f-arrow-gold)" />;
              }
              if (a.kind === "shot") {
                return <line key={a.id} x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} className="stroke-red-400" strokeWidth="3.5" strokeLinecap="round" markerEnd="url(#f-arrow-red)" />;
              }
              return <line key={a.id} x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} className="stroke-amber-400" strokeWidth="3.5" strokeLinecap="round" markerEnd="url(#f-arrow-gold)" />;
            })}

            {/* ドラッグ中のライブガイド線 */}
            {draggingId && dragOriginRef.current && (
              <line
                x1={dragOriginRef.current.x} y1={dragOriginRef.current.y}
                x2={tokens.find((t) => t.id === draggingId).x} y2={tokens.find((t) => t.id === draggingId).y}
                className="stroke-amber-300" strokeWidth="2" strokeDasharray="4 5" opacity="0.7"
              />
            )}

            {/* ブロックされたコースの演出 */}
            {blockedFlash && (
              <g>
                <line x1={blockedFlash.from.x} y1={blockedFlash.from.y} x2={blockedFlash.to.x} y2={blockedFlash.to.y} className="stroke-red-400" strokeWidth="3" strokeDasharray="3 4" strokeLinecap="round" opacity="0.85" />
                <circle cx={blockedFlash.defender.x} cy={blockedFlash.defender.y} r="19" fill="none" className="stroke-red-400" strokeWidth="2.5" />
                <text x={blockedFlash.defender.x} y={blockedFlash.defender.y - 26} textAnchor="middle" fontSize="10.5" className="fill-red-400 font-black">
                  ブロック!
                </text>
              </g>
            )}

            {/* ゴール */}
            <g onClick={handleGoalTap} className="cursor-pointer">
              <circle cx={GOAL_POINT.x} cy={GOAL_POINT.y} r="15" className="fill-stone-100" stroke="#022c22" strokeWidth="2.5" />
              <text x={GOAL_POINT.x} y={GOAL_POINT.y} textAnchor="middle" dy=".35em" fontSize="11" className="fill-emerald-950 font-black">G</text>
              <text x={GOAL_POINT.x} y={GOAL_POINT.y + 30} textAnchor="middle" fontSize="9.5" className="fill-stone-200 font-semibold">ゴール</text>
            </g>

            {/* 選手アイコン(オフェンス+ディフェンス) */}
            {tokens.map((t) => {
              const isCarrier = carrierId === t.id;
              return (
                <g
                  key={t.id}
                  onPointerDown={(e) => handlePointerDown(t, e)}
                  style={{ cursor: "grab" }}
                >
                  <circle cx={t.x} cy={t.y} r="24" fill="transparent" />
                  {isCarrier && <circle cx={t.x} cy={t.y} r="21" fill="none" className="stroke-amber-300" strokeWidth="2" strokeDasharray="2 3" opacity="0.85" />}
                  <circle
                    cx={t.x} cy={t.y} r="15"
                    className={t.isDefender ? "fill-stone-400" : "fill-amber-400"}
                    stroke="#022c22" strokeWidth="2.5"
                    opacity={t.isDefender ? 0.6 : 1}
                  />
                  {showLabels && !t.isDefender && (
                    <text x={t.x} y={t.y + 27} textAnchor="middle" fontSize="9" className="fill-stone-200 font-semibold" opacity="0.8">
                      味方
                    </text>
                  )}
                </g>
              );
            })}

            {/* ボール */}
            {ballPos && (
              <g>
                <circle cx={ballPos.x} cy={ballPos.y} r="6" className="fill-stone-100" stroke="#022c22" strokeWidth="1.5" />
                <line x1={ballPos.x - 3} y1={ballPos.y} x2={ballPos.x + 3} y2={ballPos.y} stroke="#022c22" strokeWidth="1" />
                <line x1={ballPos.x} y1={ballPos.y - 3} x2={ballPos.x} y2={ballPos.y + 3} stroke="#022c22" strokeWidth="1" />
              </g>
            )}
          </svg>
        </div>

        <p className="text-emerald-300 text-xs text-center mb-3">
          {carrierId === null
            ? "まずはボールを持たせたい選手をタップしよう"
            : "他の選手をタップでパス、保持者をドラッグでドリブル、ゴールをタップでシュート"}
          <br />
          相手選手と重なるコースは選択できません
        </p>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={undoLast}
            disabled={arrows.length === 0}
            className="flex items-center justify-center gap-1.5 bg-emerald-900 hover:bg-emerald-800 disabled:opacity-40 border border-emerald-800 text-stone-100 font-bold rounded-xl py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <Undo2 size={16} /> 1手戻す
          </button>
          <button
            onClick={() => setShowLabels((v) => !v)}
            className="flex items-center justify-center gap-1.5 bg-emerald-900 hover:bg-emerald-800 border border-emerald-800 text-stone-100 font-bold rounded-xl py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {showLabels ? <EyeOff size={16} /> : <Eye size={16} />} ラベル
          </button>
          <button
            onClick={resetAll}
            className="flex items-center justify-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-emerald-950 font-bold rounded-xl py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-amber-200"
          >
            <RotateCcw size={16} /> クリア
          </button>
        </div>
      </div>
    </div>
  );
}
