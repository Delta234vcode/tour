/// <reference types="vite/client" />

declare module 'unidecode' {
  function unidecode(s: string): string;
  export default unidecode;
}
