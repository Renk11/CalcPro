const ALLOWED_TAGS = new Set(['div', 'span', 'p', 'b', 'strong', 'i', 'ul', 'li', 'br', 'a']);
const BLOCKED_TAGS = new Set(['script', 'iframe', 'style', 'object', 'embed']);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
};

const isSafeHref = (value: string) => {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:')
  );
};

const sanitizeNode = (node: Node, documentRef: Document): Node | null => {
  if (node.nodeType === Node.TEXT_NODE) {
    return documentRef.createTextNode(node.textContent ?? '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();

  if (BLOCKED_TAGS.has(tagName)) {
    return null;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    const fragment = documentRef.createDocumentFragment();
    Array.from(element.childNodes).forEach((child) => {
      const sanitizedChild = sanitizeNode(child, documentRef);
      if (sanitizedChild) {
        fragment.appendChild(sanitizedChild);
      }
    });
    return fragment;
  }

  const cleanElement = documentRef.createElement(tagName);
  const allowedAttrs = ALLOWED_ATTRS[tagName] ?? new Set<string>();

  Array.from(element.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name.startsWith('on')) {
      return;
    }

    if (!allowedAttrs.has(name)) {
      return;
    }

    if (tagName === 'a' && name === 'href' && !isSafeHref(value)) {
      return;
    }

    cleanElement.setAttribute(name, value);
  });

  if (tagName === 'a') {
    const target = cleanElement.getAttribute('target');
    if (target === '_blank') {
      cleanElement.setAttribute('rel', 'noopener noreferrer');
    }
  }

  Array.from(element.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeNode(child, documentRef);
    if (sanitizedChild) {
      cleanElement.appendChild(sanitizedChild);
    }
  });

  return cleanElement;
};

export const sanitizeHtml = (rawHtml: string) => {
  if (!rawHtml.trim()) {
    return '';
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(rawHtml, 'text/html');
  const container = document.createElement('div');

  Array.from(parsed.body.childNodes).forEach((node) => {
    const sanitizedNode = sanitizeNode(node, document);
    if (sanitizedNode) {
      container.appendChild(sanitizedNode);
    }
  });

  return container.innerHTML;
};
