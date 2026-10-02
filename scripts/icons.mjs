import fs from 'node:fs/promises'
import sharp from 'sharp'
let seed = 271828
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const strokes = []
for (let i = 0; i < 1500; i++) {
  const angle = random() * Math.PI * 2, radius = Math.sqrt(random())
  const x = 254 + Math.cos(angle) * 158 * radius, y = 285 + Math.sin(angle) * 149 * radius
  const length = 4 + random() * 10, direction = Math.atan2(y - 240, x - 254)
  strokes.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)}q${(Math.cos(direction)*length/2).toFixed(1)} ${(Math.sin(direction)*length/2-2).toFixed(1)} ${(Math.cos(direction)*length).toFixed(1)} ${(Math.sin(direction)*length).toFixed(1)}" stroke="${i%3?'#e8edda':'#a5b39a'}" stroke-opacity="${(0.15+random()*0.3).toFixed(2)}" stroke-width="${(0.7+random()*0.9).toFixed(1)}" fill="none"/>`)
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><radialGradient id="fur" cx="38%" cy="28%" r="75%"><stop stop-color="#eef0d7"/><stop offset=".55" stop-color="#cdd8bb"/><stop offset="1" stop-color="#92a68c"/></radialGradient><linearGradient id="ear" x2=".4" y2="1"><stop stop-color="#e2e8cf"/><stop offset="1" stop-color="#a2b89d"/></linearGradient><radialGradient id="face"><stop stop-color="#fff7e4"/><stop offset="1" stop-color="#e9e9cc"/></radialGradient><filter id="fluff" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency=".10" numOctaves="3" seed="12" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter><filter id="shadow"><feGaussianBlur stdDeviation="12"/></filter><clipPath id="body"><ellipse cx="254" cy="285" rx="157" ry="149"/></clipPath></defs>
<ellipse cx="257" cy="444" rx="140" ry="17" fill="#738673" opacity=".17" filter="url(#shadow)"/>
<g class="mascot-body">
<g filter="url(#fluff)"><g class="mascot-ear-left"><path d="M151 204C80 180 80 69 129 56C166 46 195 136 187 180Z" fill="url(#ear)"/><path d="M139 171C112 147 104 98 126 92C144 87 162 138 161 168" fill="#e9c9b9" opacity=".6"/></g>
<g class="mascot-ear-right"><path d="M290 172C290 94 317 41 350 58C390 79 362 182 338 207Z" fill="url(#ear)"/><path d="M315 163C319 113 337 82 349 98C359 120 344 160 333 178" fill="#e9c9b9" opacity=".6"/></g>
<ellipse cx="127" cy="347" rx="34" ry="57" transform="rotate(-22 127 347)" fill="#b5c5a8"/><ellipse cx="382" cy="349" rx="30" ry="54" transform="rotate(22 382 349)" fill="#b5c5a8"/>
<ellipse cx="254" cy="285" rx="157" ry="149" fill="url(#fur)"/></g><g clip-path="url(#body)">${strokes.join('')}</g>
<ellipse cx="255" cy="302" rx="111" ry="94" fill="url(#face)" opacity=".96" filter="url(#fluff)"/>
<g class="mascot-eyes">
<ellipse cx="207" cy="287" rx="12" ry="17" fill="#354337" transform="rotate(-6 207 287)"/><ellipse cx="301" cy="284" rx="12" ry="17" fill="#354337" transform="rotate(6 301 284)"/>
<circle cx="204" cy="281" r="4" fill="#fff"/><circle cx="298" cy="278" r="4" fill="#fff"/>
</g>
<ellipse cx="180" cy="316" rx="19" ry="10" fill="#e8afa0" opacity=".64"/><ellipse cx="330" cy="313" rx="19" ry="10" fill="#e8afa0" opacity=".64"/>
<path d="M246 310Q255 304 264 310Q255 322 246 310" fill="#6b7260"/><g class="mascot-mouth"><path d="M255 317v7m-14-1q14 18 28-1" stroke="#677461" stroke-width="3.8" stroke-linecap="round" fill="none"/></g>
<path d="M168 375Q251 410 336 373L328 396Q256 427 179 399Z" fill="#738c77" filter="url(#fluff)"/><path d="M289 401l20 53q18 4 29-8l-20-47" fill="#718977" filter="url(#fluff)"/>
<ellipse cx="196" cy="418" rx="43" ry="27" fill="#d9e1c6" filter="url(#fluff)"/><path d="M179 421l-1 7m13-6v8" stroke="#a8b69a" stroke-width="2.5" stroke-linecap="round"/>
<g class="mascot-paw"><ellipse cx="303" cy="419" rx="43" ry="27" fill="#d9e1c6" filter="url(#fluff)"/><path d="M284 419v7m13-5v8" stroke="#a8b69a" stroke-width="2.5" stroke-linecap="round"/></g>
<path d="M251 143q-8-18 7-31q16 18 7 33" fill="#9db89b"/><path d="M258 146q10-23 26-13q-8 17-26 13" fill="#7b9b7c"/>
</g>
</svg>`
await fs.mkdir('src', { recursive: true })
await fs.writeFile('src/mascot-live.svg', svg.replace(strokes.join(''), strokes.slice(0, 220).join('')))
if (!process.argv.includes('--live-only')) {
await fs.mkdir('public', { recursive: true })
await fs.writeFile('public/mascot.svg', svg)
await sharp(Buffer.from(svg)).resize(768).webp({ quality: 93 }).toFile('public/mascot.webp')
await sharp({ create: { width:1024, height:1024, channels:4, background:'#f3f0e6' } }).composite([{ input: await sharp(Buffer.from(svg)).resize(900).png().toBuffer(), left:62, top:62 }]).png().toFile('public/icon.png')
const sizes = { mdpi:48, hdpi:72, xhdpi:96, xxhdpi:144, xxxhdpi:192 }
for (const [density,size] of Object.entries(sizes)) {
  const dir = `android/app/src/main/res/mipmap-${density}`
  await fs.mkdir(dir, { recursive:true })
  for (const name of ['ic_launcher','ic_launcher_round']) await sharp('public/icon.png').resize(size).png().toFile(`${dir}/${name}.png`)
  await sharp(Buffer.from(svg)).resize(size*2).png().toFile(`${dir}/ic_launcher_foreground.png`)
}
}
console.log('原创苔兔应用素材已生成')
