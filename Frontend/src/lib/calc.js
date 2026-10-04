// Safe arithmetic evaluator (no eval): numbers, + - × ÷ %, parentheses, unary minus.
// Percent works like a pocket calculator: "2400 × 18%" = 432 and "500 + 10%" = 550.

function tokenize(input) {
  const src = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/\s+/g, '');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/[\d.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j])) j++;
      const num = Number(src.slice(i, j));
      if (Number.isNaN(num)) throw new Error('Invalid number');
      tokens.push({ type: 'num', value: num });
      i = j;
    } else if ('+-*/()%'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
    } else {
      throw new Error(`Unexpected "${ch}"`);
    }
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos]?.value;
  const take = () => tokens[pos++];

  function primary() {
    const t = take();
    if (!t) throw new Error('Incomplete expression');
    if (t.type === 'num') return t.value;
    if (t.value === '-') return -primary();
    if (t.value === '+') return primary();
    if (t.value === '(') {
      const v = expr();
      if (take()?.value !== ')') throw new Error('Missing )');
      return v;
    }
    throw new Error('Incomplete expression');
  }

  function postfix() {
    let value = primary();
    let percent = false;
    while (peek() === '%') {
      take();
      value /= 100;
      percent = true;
    }
    return { value, percent };
  }

  function term() {
    const first = postfix();
    let value = first.value;
    let single = true;
    while (peek() === '*' || peek() === '/') {
      single = false;
      const op = take().value;
      const right = postfix().value;
      if (op === '/' && right === 0) throw new Error('Cannot divide by 0');
      value = op === '*' ? value * right : value / right;
    }
    return { value, percent: single && first.percent };
  }

  function expr() {
    let left = term().value;
    while (peek() === '+' || peek() === '-') {
      const op = take().value;
      const right = term();
      const amount = right.percent ? left * right.value : right.value;
      left = op === '+' ? left + amount : left - amount;
    }
    return left;
  }

  const result = expr();
  if (pos < tokens.length) throw new Error('Unexpected input');
  return result;
}

export function evaluate(input) {
  if (input == null || !String(input).trim()) return null;
  const tokens = tokenize(String(input));
  if (!tokens.length) return null;
  const result = parse(tokens);
  if (!Number.isFinite(result)) throw new Error('Invalid result');
  return Math.round(result * 1e8) / 1e8;
}

export function tryEvaluate(input) {
  try {
    return evaluate(input);
  } catch {
    return null;
  }
}

export const isExpression = (input) => /[+\-*/×÷%()]/.test(String(input).trim().replace(/^-/, ''));
