import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  DEFAULT_TICK_MS,
  Direction,
  createSnakeGame,
  pointKey,
  queueDirection,
  restartSnakeGame,
  stepSnakeGame,
  togglePause,
} from '../features/snake/gameLogic';

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  a: 'left',
  A: 'left',
  s: 'down',
  S: 'down',
  d: 'right',
  D: 'right',
};

function ControlButton({
  label,
  icon: Icon,
  onClick,
  className = '',
  disabled = false,
}: {
  label: string;
  icon: typeof ArrowUp;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-12 w-12 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white ${className}`}
    >
      <Icon size={18} />
    </button>
  );
}

export default function SnakeGame() {
  const [game, setGame] = useState(() => createSnakeGame());

  useEffect(() => {
    if (game.status !== 'running') return undefined;

    const timer = window.setInterval(() => {
      setGame(current => stepSnakeGame(current));
    }, DEFAULT_TICK_MS);

    return () => window.clearInterval(timer);
  }, [game.status]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;

      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const direction = KEY_TO_DIRECTION[event.key];
      if (direction) {
        event.preventDefault();
        setGame(current => queueDirection(current, direction));
        return;
      }

      if (event.key === ' ' || event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        setGame(current => togglePause(current));
        return;
      }

      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        setGame(current => restartSnakeGame(current));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const snakeCells = useMemo(() => new Set(game.snake.map(pointKey)), [game.snake]);
  const headKey = pointKey(game.snake[0]);
  const foodKey = game.food ? pointKey(game.food) : null;

  const boardCells = useMemo(
    () => Array.from({ length: game.boardSize * game.boardSize }, (_, index) => {
      const x = index % game.boardSize;
      const y = Math.floor(index / game.boardSize);
      const key = pointKey({ x, y });
      const isHead = key === headKey;
      const isSnake = snakeCells.has(key);
      const isFood = key === foodKey;

      let cellClass = 'border border-slate-200 bg-white';

      if (isFood) cellClass = 'border border-red-200 bg-red-500';
      else if (isHead) cellClass = 'border border-slate-800 bg-slate-900';
      else if (isSnake) cellClass = 'border border-slate-700 bg-slate-700';

      return <div key={key} className={`aspect-square rounded-[2px] ${cellClass}`} />;
    }),
    [foodKey, game.boardSize, headKey, snakeCells],
  );

  const statusLabel = game.status === 'game-over'
    ? 'Game Over'
    : game.status === 'paused'
      ? 'Paused'
      : 'Running';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-8">
      <div className="card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Snake</h1>
            <p className="text-sm text-slate-500">
              Classic grid movement with wall collisions, food, score, pause, and restart.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setGame(current => togglePause(current))}
              disabled={game.status === 'game-over'}
              className="btn-secondary gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {game.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
              {game.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => setGame(current => restartSnakeGame(current))}
              className="btn-primary gap-2"
            >
              <RotateCcw size={16} />
              Restart
            </button>
            <Link to="/dashboard" className="btn-secondary">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="card">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Score</div>
              <div className="text-2xl font-bold text-slate-800">{game.score}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Status</div>
              <div className="text-sm font-semibold text-slate-800">{statusLabel}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Controls</div>
              <div className="text-sm text-slate-700">Arrows / WASD</div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[28rem]">
            <div
              className="grid rounded-xl border border-slate-300 bg-slate-100 p-2"
              style={{ gridTemplateColumns: `repeat(${game.boardSize}, minmax(0, 1fr))` }}
            >
              {boardCells}
            </div>
          </div>

          {game.status !== 'running' && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {game.status === 'paused'
                ? 'The game is paused. Press space or use Resume to continue.'
                : 'You hit a wall or yourself. Press R or Restart to begin again.'}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="section-title mb-4">Quick Controls</h2>
          <div className="mb-4 text-sm text-slate-600">
            Use the keyboard on desktop or the touch controls below on mobile.
          </div>

          <div className="mx-auto mb-5 grid w-40 grid-cols-3 gap-2">
            <div />
            <ControlButton label="Move up" icon={ArrowUp} disabled={game.status === 'game-over'} onClick={() => setGame(current => queueDirection(current, 'up'))} />
            <div />
            <ControlButton label="Move left" icon={ArrowLeft} disabled={game.status === 'game-over'} onClick={() => setGame(current => queueDirection(current, 'left'))} />
            <ControlButton label="Move down" icon={ArrowDown} disabled={game.status === 'game-over'} onClick={() => setGame(current => queueDirection(current, 'down'))} />
            <ControlButton label="Move right" icon={ArrowRight} disabled={game.status === 'game-over'} onClick={() => setGame(current => queueDirection(current, 'right'))} />
          </div>

          <div className="space-y-3 text-sm text-slate-600">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              Food adds one point and one segment.
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              Hitting the wall or your own body ends the run.
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              Space or P toggles pause. R restarts instantly.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
