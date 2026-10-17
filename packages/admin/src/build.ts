// The library build's entry. Importing the stylesheet here makes Vite compile
// it to dist/studio.css; library mode keeps CSS out of the JavaScript, so
// pages import '@vesper/admin/studio.css' themselves.
import './studio.css';

export * from './index.ts';
