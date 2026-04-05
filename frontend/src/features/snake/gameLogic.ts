export type Direction = 'up' | 'down' | 'left' | 'right';
export type GameStatus = 'running' | 'paused' | 'game-over';

export interface GridPoint {
  x: number;
  y: number;
}

export interface SnakeGameState {
  boardSize: number;
  snake: GridPoint[];
  direction: Direction;
  nextDirection: Direction;
  food: GridPoint | null;
  score: number;
  status: GameStatus;
}

export const DEFAULT_BOARD_SIZE = 16;
export const DEFAULT_TICK_MS = 160;

const DIRECTION_VECTORS: Record<Direction, GridPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function pointKey(point: GridPoint): string {
  return `${point.x}:${point.y}`;
}

export function pointsEqual(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

export function createSnakeGame(
  boardSize = DEFAULT_BOARD_SIZE,
  randomFn: () => number = Math.random,
): SnakeGameState {
  const center = Math.floor(boardSize / 2);
  const snake: GridPoint[] = [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center },
  ];

  return {
    boardSize,
    snake,
    direction: 'right',
    nextDirection: 'right',
    food: placeFood(snake, boardSize, randomFn),
    score: 0,
    status: 'running',
  };
}

export function restartSnakeGame(
  state: SnakeGameState,
  randomFn: () => number = Math.random,
): SnakeGameState {
  return createSnakeGame(state.boardSize, randomFn);
}

export function queueDirection(state: SnakeGameState, nextDirection: Direction): SnakeGameState {
  if (state.status === 'game-over') return state;
  if (OPPOSITE_DIRECTIONS[state.direction] === nextDirection) return state;
  return { ...state, nextDirection };
}

export function togglePause(state: SnakeGameState): SnakeGameState {
  if (state.status === 'game-over') return state;
  return {
    ...state,
    status: state.status === 'paused' ? 'running' : 'paused',
  };
}

export function stepSnakeGame(
  state: SnakeGameState,
  randomFn: () => number = Math.random,
): SnakeGameState {
  if (state.status !== 'running' || !state.food) return state;

  const direction = state.nextDirection;
  const vector = DIRECTION_VECTORS[direction];
  const nextHead = {
    x: state.snake[0].x + vector.x,
    y: state.snake[0].y + vector.y,
  };

  const willGrow = pointsEqual(nextHead, state.food);
  const collisionBody = willGrow ? state.snake : state.snake.slice(0, -1);
  const hitWall = !isWithinBounds(nextHead, state.boardSize);
  const hitSelf = collisionBody.some(segment => pointsEqual(segment, nextHead));

  if (hitWall || hitSelf) {
    return {
      ...state,
      direction,
      nextDirection: direction,
      status: 'game-over',
    };
  }

  const snake = willGrow
    ? [nextHead, ...state.snake]
    : [nextHead, ...state.snake.slice(0, -1)];

  const food = willGrow ? placeFood(snake, state.boardSize, randomFn) : state.food;
  const boardFilled = willGrow && !food;

  return {
    ...state,
    snake,
    direction,
    nextDirection: direction,
    food,
    score: willGrow ? state.score + 1 : state.score,
    status: boardFilled ? 'game-over' : state.status,
  };
}

export function placeFood(
  snake: GridPoint[],
  boardSize: number,
  randomFn: () => number = Math.random,
): GridPoint | null {
  const occupied = new Set(snake.map(pointKey));
  const availableCells: GridPoint[] = [];

  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      if (!occupied.has(pointKey({ x, y }))) {
        availableCells.push({ x, y });
      }
    }
  }

  if (availableCells.length === 0) return null;

  const index = Math.floor(randomFn() * availableCells.length);
  return availableCells[index];
}

function isWithinBounds(point: GridPoint, boardSize: number): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < boardSize && point.y < boardSize;
}
