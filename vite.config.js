// Dev server with a small endpoint that saves rendered tour frames (used to make the video).
import fs from 'node:fs';
import path from 'node:path';

export default {
  base: './', // relative asset paths, so the build works from GitHub Pages' /pyramid-builders/ subpath
  plugins: [{
    name: 'frame-sink',
    configureServer(server) {
      server.middlewares.use('/__frame', (req, res) => {
        const q = new URL(req.url, 'http://local').searchParams;
        const name = q.get('name');
        const i = Number(q.get('i') || 0);
        const dir = path.resolve(name ? 'recording' : 'recording/frames');
        fs.mkdirSync(dir, { recursive: true });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.writeFileSync(path.join(dir, name ? `${name.replace(/[^\w-]/g, '')}.jpg` : `f${String(i).padStart(5, '0')}.jpg`), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  }],
};
