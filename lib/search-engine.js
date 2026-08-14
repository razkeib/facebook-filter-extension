/**
 * Tokenizes the raw search string into manageable pieces.
 * Matches field:"strings", field:/regex/i, /regex/i, "strings", operators, and raw words.
 */
function tokenize(query) {
  const tokenRegex = /[a-zA-Z0-9_-]+:\/(?:\\.|[^\/\\])+\/[gimsuy]*|[a-zA-Z0-9_-]+:"(?:\\.|[^"\\])+"|\/(?:\\.|[^\/\\])+\/[gimsuy]*|"(?:\\.|[^"\\])+"|[()!]|AND|OR|NOT|&&|\|\||[^\s()]+/g;
  return query.match(tokenRegex) || [];
}

/**
 * Parses tokens into an Abstract Syntax Tree (AST) using Recursive Descent.
 */
function parse(tokens) {
  let current = 0;

  function peek() { return tokens[current]; }
  function consume() { return tokens[current++]; }

  function parseExpression() {
    let node = parseTerm();
    while (current < tokens.length && (peek() === 'OR' || peek() === '||')) {
      consume();
      node = { type: 'OR', left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parseFactor();
    while (current < tokens.length && peek() !== 'OR' && peek() !== '||' && peek() !== ')') {
      if (peek() === 'AND' || peek() === '&&') {
        consume();
      } else if (peek() === 'NOT' || peek() === '!') {
        // Handled below, but skipped here to allow implicit ANDs
      }

      // Implicit AND if two factors are placed side-by-side
      if (current < tokens.length && peek() !== 'OR' && peek() !== '||' && peek() !== ')') {
         node = { type: 'AND', left: node, right: parseFactor() };
      }
    }
    return node;
  }

  function parseFactor() {
    if (current >= tokens.length) return null;
    let token = peek();

    if (token === 'NOT' || token === '!') {
      consume();
      return { type: 'NOT', operand: parseFactor() };
    }

    if (token === '(') {
      consume();
      let node = parseExpression();
      if (peek() === ')') consume();
      return node;
    }

    return parseLeaf(consume());
  }

  function parseLeaf(token) {
    // 1. Check for targeted field (e.g., author:"John", text:/crypto/i)
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0 && !token.startsWith('"') && !token.startsWith('/')) {
      const field = token.substring(0, colonIdx);
      const val = token.substring(colonIdx + 1);
      return { type: 'FIELD', field, value: parseLeaf(val) };
    }

    // 2. Check for Regex
    if (token.startsWith('/')) {
      return { type: 'REGEX', regex: extractRegex(token) };
    }

    // 3. Check for Quoted String
    if (token.startsWith('"') && token.endsWith('"')) {
      return { type: 'STRING', value: token.slice(1, -1).toLowerCase() };
    }

    // 4. Plain Keyword
    return { type: 'WORD', value: token.toLowerCase() };
  }

  function extractRegex(token) {
    const lastSlash = token.lastIndexOf('/');
    const pattern = token.substring(1, lastSlash);
    const flags = token.substring(lastSlash + 1);
    try {
      return new RegExp(pattern, flags);
    } catch (e) {
      // Fallback if regex syntax is invalid
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");
    }
  }

  if (tokens.length === 0) return null;
  return parseExpression();
}

/**
 * Evaluates the AST against a single Facebook post object.
 */
function evaluate(ast, post) {
  if (!ast) return true;

  const textToSearch = (post.text || '').toLowerCase();
  const authorToSearch = (post.author?.name || '').toLowerCase();

  switch (ast.type) {
    case 'AND': return evaluate(ast.left, post) && evaluate(ast.right, post);
    case 'OR':  return evaluate(ast.left, post) || evaluate(ast.right, post);
    case 'NOT': return !evaluate(ast.operand, post);

    case 'REGEX':
      return ast.regex.test(post.text || '');

    case 'STRING':
    case 'WORD':
      return textToSearch.includes(ast.value) || authorToSearch.includes(ast.value);

    case 'FIELD':
      let targetText = '';
      if (ast.field === 'author') targetText = post.author?.name || '';
      if (ast.field === 'group') targetText = post.group?.name || '';
      if (ast.field === 'text') targetText = post.text || '';

      if (ast.value.type === 'REGEX') {
        return ast.value.regex.test(targetText);
      } else {
        return targetText.toLowerCase().includes(ast.value.value);
      }

    default:
      return false;
  }
}

/**
 * Main export: Filters an array of posts based on the query string.
 */
export function executeSearch(query, posts) {
  if (!query || !query.trim()) return posts;

  try {
    const tokens = tokenize(query);
    const ast = parse(tokens);
    return posts.filter(post => evaluate(ast, post));
  } catch (err) {
    console.warn("[Search Engine] Parse error, falling back to basic search:", err);
    // Graceful fallback to basic substring match if syntax tree fails
    const lowerQuery = query.toLowerCase();
    return posts.filter(post =>
      (post.text || '').toLowerCase().includes(lowerQuery) ||
      (post.author?.name || '').toLowerCase().includes(lowerQuery)
    );
  }
}

/**
 * Extracts active search terms from the query for UI highlighting.
 * Safely skips negated terms (NOT) to avoid highlighting excluded words.
 */
export function getHighlightTerms(query) {
  if (!query || !query.trim()) return [];

  try {
    const tokens = tokenize(query);
    const ast = parse(tokens);
    const terms = [];

    function traverse(node) {
      if (!node) return;

      if (node.type === 'AND' || node.type === 'OR') {
        traverse(node.left);
        traverse(node.right);
      }

      // Skip NOT nodes completely so we don't highlight words we want to hide
      if (node.type === 'NOT') return;

      if (node.type === 'STRING' || node.type === 'WORD') {
        terms.push({ type: 'text', value: node.value });
      }
      if (node.type === 'REGEX') {
        terms.push({ type: 'regex', value: node.regex });
      }
      if (node.type === 'FIELD' && (node.field === 'text' || node.field === 'author')) {
        traverse(node.value);
      }
    }

    traverse(ast);
    return terms;
  } catch (err) {
    // Fallback if AST parsing fails
    return [{ type: 'text', value: query.toLowerCase() }];
  }
}
