// The only platform APIs the core may use beyond plain ECMAScript: the WHATWG URL classes, which
// Node, browsers, web workers and Deno all provide. tsconfig.core.json type-checks the core with
// this file and without Node or DOM types, so any other platform API is a compile error.

interface URLSearchParams {
  get(name: string): string | null;
  delete(name: string): void;
  keys(): IterableIterator<string>;
  sort(): void;
  toString(): string;
}

declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (init?: Record<string, string> | string): URLSearchParams;
};

interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  origin: string;
  pathname: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
}

declare var URL: {
  prototype: URL;
  new (url: string, base?: string | URL): URL;
};
