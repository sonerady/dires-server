// Template-specific space constraints, shared by the still and motion artwork.
function localizedLayout(id, lang, copy) {
  if (id === "receipt-print") {
    const stampLength = Math.max(4, [...(copy["−30%"] || "−30%")].length);
    return `
      .banner { display:grid; grid-template-areas:"shot shot" "kick stamp" "receipt receipt"; grid-template-columns:minmax(0,1fr) 16vmin; grid-template-rows:minmax(0,1fr) auto auto; gap:3vmin; padding:0 5vmin 4vmin; box-sizing:border-box; }
      .shot, .kick, .rwrap, .stamp { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .shot { grid-area:shot; margin-inline:-5vmin; max-width:none; }.shot img { position:absolute; inset:0; }
      .kick { grid-area:kick; align-self:center; white-space:normal; font-size:2.2vmin; line-height:1.4; letter-spacing:.03em; }
      .stamp { grid-area:stamp; display:flex; width:15vmin; height:15vmin; padding:2vmin; font-size:min(3.5vmin,${(13 / stampLength).toFixed(2)}vmin); line-height:1.3; text-align:center; color:#fff; border-color:#fff; mix-blend-mode:normal; transform:rotate(8deg); }
      .stamp { white-space:nowrap; }.stamp::after { border-color:#fff; }.stamp small { white-space:normal; font-size:1.5vmin; line-height:1.2; letter-spacing:.02em; }
      .rwrap { grid-area:receipt; margin-inline:2vmin; transform:rotate(-1deg); }
      .receipt { height:auto; padding:4vmin 4vmin 3vmin; }
      .logo { font-size:4.2vmin; line-height:1.2; }
      .meta { font-size:2.3vmin; line-height:1.4; margin-top:1vmin; }
      .rule { margin:1.4vmin 0; }
      .x { display:block!important; }.line.x { display:flex!important; }
      .line { font-size:2.6vmin; line-height:1.4; gap:1vmin; }
      .line .n { flex:0 1 auto; min-width:0; overflow-wrap:anywhere; }
      .line .p { flex:0 0 auto; white-space:nowrap; }
      .line .dots { min-width:1vmin; }
      .total { font-size:2.8vmin; line-height:1.3; gap:2vmin; flex-wrap:wrap; }
      .total b { font-size:4vmin; line-height:1.3; overflow-wrap:anywhere; }
      .saved { text-align:end; font-size:2.4vmin; line-height:1.4; }
      .bars { height:4vmin; margin-top:1.5vmin; }
      .thanks { font-size:2vmin; line-height:1.4; letter-spacing:.02em; margin-top:1.2vmin; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"shot kick stamp" "shot receipt receipt"; grid-template-columns:minmax(0,.38fr) minmax(0,.62fr) 13vmin; grid-template-rows:auto minmax(0,1fr); gap:3vmin; padding:4vmin; }
        .shot { margin:-4vmin 0 -4vmin -4vmin; }
        html[dir="rtl"] .shot { margin:-4vmin -4vmin -4vmin 0; }
        .kick { font-size:1.8vmin; }
        .stamp { width:12vmin; height:12vmin; font-size:min(3vmin,${(11 / stampLength).toFixed(2)}vmin); }.stamp small { font-size:1.25vmin; }
        .rwrap { align-self:start; margin:0 1vmin; }
        .receipt { padding:3.5vmin 2.5vmin 2.5vmin; }
        .logo { font-size:3.5vmin; }.meta { font-size:2vmin; }
        .line { font-size:2.2vmin; }.total { font-size:2.5vmin; }.total b { font-size:3.5vmin; }
        .saved { font-size:2.1vmin; }.thanks { font-size:1.9vmin; }
      }
    `;
  }
  if (id === "varsity-letter") {
    const longest = Math.max(...(copy.Varsity || "Varsity").split(/\s+/).map(word => [...word].length));
    const badgeLength = [...(copy["ATHLETIC DEPT."] || "ATHLETIC DEPT.")].length;
    const yearLength = [...(copy["26"] || "26")].length;
    return `
      .banner { display:grid; grid-template-areas:"shot" "rib" "panel"; grid-template-rows:minmax(0,1fr) 5vmin auto; }
      .shot, .rib, .panel { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; margin:0; box-sizing:border-box; }
      .shot { grid-area:shot; }.shot img { position:absolute; inset:0; }
      .rib { grid-area:rib; }
      .panel { grid-area:panel; padding:5vmin; grid-template-columns:minmax(0,.35fr) minmax(0,.65fr); grid-template-rows:auto auto; gap:5vmin; }
      .patch { width:100%; height:auto; max-height:30vmin; grid-row:1; align-self:center; }
      .patch text:has(textPath) { font-size:${Math.min(15, 230 / badgeLength).toFixed(2)}px; letter-spacing:.5px; }
      .patch > text[x="100"] { font-size:${Math.min(78, 180 / yearLength).toFixed(2)}px; }
      .words { min-width:0; margin:0; container-type:inline-size; }
      .dept { font-size:1.9vmin; line-height:1.4; letter-spacing:.03em; }
      h1 { font-size:min(8vmin,${(125 / longest).toFixed(2)}cqw); line-height:1.1; overflow-wrap:anywhere; margin:2vmin 0; }
      .script { font-size:5vmin; line-height:1.4; margin:0; padding:0; padding-inline-start:1vmin; transform:rotate(-4deg); transform-origin:center; }
      .offer { grid-row:2; padding-top:3vmin; gap:3vmin; flex-wrap:wrap; }
      .offer p { font-size:2.4vmin; line-height:1.5; letter-spacing:.03em; min-width:0; }
      .btn { flex:0 1 auto; max-width:100%; box-sizing:border-box; font-size:2.4vmin; line-height:1.4; letter-spacing:.03em; padding:2.5vmin 3vmin; overflow-wrap:anywhere; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"panel rib shot"; grid-template-columns:minmax(0,.55fr) 4vmin minmax(0,.45fr); grid-template-rows:minmax(0,1fr); }
        .panel { padding:5vmin 4vmin; grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto minmax(0,1fr); gap:4vmin; }
        .patch { width:26vmin; max-height:26vmin; justify-self:center; }
        .words { grid-row:2; }
        h1 { font-size:min(7vmin,${(125 / longest).toFixed(2)}cqw); }
        .script { font-size:4.8vmin; }
        .offer { grid-row:3; align-self:end; flex-direction:column; align-items:flex-start; gap:2vmin; }
        .offer p, .btn { font-size:2.2vmin; }
      }
      @media(min-aspect-ratio:6/5) {
        .panel { grid-template-columns:minmax(0,.35fr) minmax(0,.65fr); grid-template-rows:minmax(0,1fr) auto; gap:4vmin; }
        .patch { width:100%; max-height:30vmin; }
        .words { grid-row:1; }
        h1 { font-size:min(7vmin,${(125 / longest).toFixed(2)}cqw); }
        .offer { grid-row:2; flex-direction:row; align-items:center; }
      }
    `;
  }
  if (id === "restock-board") {
    const title = copy.RESTOCK || "RESTOCK";
    const letters = Math.max(7, [...title].length);
    const longest = Math.max(...title.split(/\s+/).map(word => [...word].length));
    return `
      .banner { display:grid; grid-template-areas:"shot" "board"; grid-template-rows:minmax(0,1fr) auto; }
      .shot, .board { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; box-sizing:border-box; }
      .shot { grid-area:shot; }.shot img { position:absolute; inset:0; }
      .board { grid-area:board; padding:4vmin 5vmin; gap:2vmin; container-type:inline-size; }
      .live { left:auto; inset-inline-start:4vmin; max-width:80%; box-sizing:border-box; font-size:1.8vmin; line-height:1.4; letter-spacing:.03em; }
      .live i { flex-shrink:0; }
      .top { flex-wrap:wrap; gap:1vmin 3vmin; font-size:1.7vmin; line-height:1.4; letter-spacing:.02em; }
      .top span:last-child { display:inline; }
      .top > span { min-width:0; }
      .flaps { gap:.5vmin; margin:0; min-width:0; }
      .flaps > span { zoom:1!important; min-width:0; height:10vmin; font-size:min(8vmin,${(125 / letters).toFixed(2)}cqw); }
      .flaps > bdi { font-size:min(8vmin,${(125 / longest).toFixed(2)}cqw)!important; line-height:1.2!important; padding:1.5vmin; box-sizing:border-box; background:linear-gradient(180deg,#262626 0 50%,#1c1c1c 50%); border-radius:.6vmin; text-align:center; }
      .rows { margin:0; }
      .row, .row.x { display:grid; grid-template-columns:minmax(0,.22fr) minmax(0,.55fr) minmax(0,.23fr); gap:2vmin; font-size:2vmin; line-height:1.4; padding:.7vmin 0; letter-spacing:.02em; }
      .row > span { min-width:0; overflow-wrap:anywhere; }
      .row .q, .row.head > span:last-child { text-align:end; }
      .row.head { font-size:1.6vmin; letter-spacing:.02em; }
      .count { margin:0; padding:0; flex-wrap:wrap; gap:2vmin; font-size:1.7vmin; line-height:1.4; letter-spacing:.02em; }
      .count > span { min-width:0; }.count b { font-size:2.2vmin; }.count i { min-width:8vmin; }
      .cta { margin:0; padding:2vmin 3vmin; font-size:2.5vmin; line-height:1.4; letter-spacing:.02em; gap:2vmin; }
      .cta > span:last-child { flex-shrink:0; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"shot board"; grid-template-columns:minmax(0,.42fr) minmax(0,.58fr); grid-template-rows:minmax(0,1fr); }
        .board { padding:4vmin; justify-content:space-between; gap:2vmin; }
        .flaps > span { height:9vmin; }
        .cta { font-size:2.2vmin; }
      }
    `;
  }
  if (id === "graffiti-throw") {
    const fresh = copy.FRESH || "FRESH";
    const length = Math.max(4, [...fresh].length);
    return `
      .banner { display:grid; grid-template-areas:"shot" "wall"; grid-template-rows:minmax(0,1fr) auto; }
      .shot, .wall { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; box-sizing:border-box; }
      .shot { grid-area:shot; }
      .shot img { position:absolute; inset:0; }
      .wall { grid-area:wall; display:flex; flex-direction:column; padding:8vmin 6vmin 6vmin; gap:7vmin; container-type:inline-size; }
      .piece, .tag, .deal { position:relative; inset:auto; width:auto; height:auto; min-width:0; max-width:100%; box-sizing:border-box; }
      .piece { margin:0 3vmin 7vmin; }
      .throw { font-size:min(20vmin,${(110 / length).toFixed(2)}cqw); line-height:1.2; letter-spacing:0; max-width:100%; --o:.65vmin; }
      .throw .halo { -webkit-text-stroke-width:3vmin; text-shadow:1.5vmin 1.5vmin 0 #fff; }
      .throw .hi, .throw .halo { inset-inline-start:0; inset-inline-end:auto; width:100%; }
      .throw span[lang] { font:inherit; display:inline; }
      .drip { height:6vmin; width:1vmin; box-shadow:0 0 0 .3vmin #111; }
      .d2 { height:4vmin; }.d3 { height:7vmin; }
      .tag { font-size:5vmin; line-height:1.3; transform:rotate(-5deg); align-self:flex-end; margin-inline:4vmin; }
      .deal { gap:4vmin; flex-wrap:wrap; align-items:center; }
      .stencil { min-width:0; max-width:100%; box-sizing:border-box; padding:2vmin 3vmin; }
      .stencil b { font-size:6vmin; line-height:1.25; }
      .stencil span { white-space:normal; font-size:2vmin; line-height:1.4; letter-spacing:.03em; }
      .stencil span[lang] { display:inline; font:inherit; margin:0; }
      .cta { flex:0 1 auto; max-width:100%; font-size:2.6vmin; line-height:1.4; letter-spacing:.03em; overflow-wrap:anywhere; }
      .cta small { font-size:1.9vmin; line-height:1.4; letter-spacing:.03em; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"wall shot"; grid-template-columns:minmax(0,.55fr) minmax(0,.45fr); grid-template-rows:minmax(0,1fr); }
        .wall { gap:6vmin; padding:8vmin 5vmin 5vmin; justify-content:space-between; }
        .piece { margin:0 2vmin 5vmin; }
        .throw { font-size:min(14vmin,${(105 / length).toFixed(2)}cqw); }
        .tag { font-size:4.8vmin; margin-inline:2vmin; }
        .deal { flex-direction:column; align-items:flex-start; gap:4vmin; }
        .stencil b { font-size:5.6vmin; }
        .cta { font-size:2.4vmin; }
      }
      @media(min-aspect-ratio:6/5) {
        .wall { gap:5vmin; }
        .deal { flex-direction:row; align-items:flex-end; }
      }
    `;
  }
  if (id === "collab-x") {
    return `
      .banner { display:grid; grid-template-areas:"top" "lock" "shot" "bar"; grid-template-rows:auto auto minmax(0,1fr) auto; gap:4vmin; padding-top:4vmin; box-sizing:border-box; }
      .top, .lock, .shot, .bar { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .top { grid-area:top; margin-inline:5vmin; gap:3vmin; font-size:1.8vmin; line-height:1.4; letter-spacing:.03em; }
      .top > span { min-width:0; }
      .lock { grid-area:lock; margin-inline:5vmin; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:2vmin; padding-block:2vmin; direction:ltr; }
      .a { font-size:7vmin; }
      .b { font-size:10vmin; text-align:right; }
      .a, .b { min-width:0; }
      .a small, .b small { font-size:1.7vmin; letter-spacing:.08em; line-height:1.3; }
      .x { width:12vmin; height:12vmin; margin:0; }
      .shot { grid-area:shot; }
      .shot img { position:absolute; inset:0; }
      .bar { grid-area:bar; padding:3vmin 5vmin; gap:3vmin; flex-wrap:wrap; }
      .when { min-width:0; max-width:100%; font-size:1.9vmin; letter-spacing:.03em; line-height:1.5; }
      .when b { font-size:4vmin; line-height:1.2; margin-block:1vmin; }
      .cta { min-width:0; max-width:100%; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; font-size:2vmin; line-height:1.4; letter-spacing:.03em; padding:2vmin 3vmin; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"shot top" "shot lock" "shot bar"; grid-template-columns:minmax(0,.46fr) minmax(0,.54fr); grid-template-rows:auto minmax(0,1fr) auto; padding:0; gap:3vmin 0; }
        .top { margin:4vmin 4vmin 0; flex-direction:column; gap:1vmin; }
        .lock { margin:0 4vmin; grid-template-columns:1fr; justify-items:start; align-content:center; gap:3vmin; }
        .a { font-size:5vmin; }
        .b { text-align:left; font-size:8vmin; }
        .x { width:6vmin; height:6vmin; margin-inline-start:1vmin; }
        .bar { padding:3vmin 4vmin; flex-direction:column; align-items:flex-start; gap:2vmin; }
        .when b { font-size:3.5vmin; }
        .cta { font-size:1.9vmin; padding:1.5vmin 2vmin; }
      }
      @media(min-aspect-ratio:6/5) {
        .lock { grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:2vmin; }
        .a { font-size:5.7vmin; }
        .b { font-size:8vmin; }
        .x { margin:0; }
      }
    `;
  }
  if (id === "tech-spec") {
    const longest = Math.max(...[copy.Utility || "Utility", (copy.series || "series") + "_07"].flatMap(text => text.split(/\s+/)).map(word => [...word].length));
    return `
      .banner { display:grid; grid-template-areas:"doc" "fig" "data"; grid-template-rows:auto minmax(0,1fr) auto; gap:7vmin; padding:4vmin 5vmin 5vmin; box-sizing:border-box; }
      .doc, .fig, .data { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .doc { grid-area:doc; font-size:1.5vmin; line-height:1.4; letter-spacing:.03em; gap:3vmin; }
      .doc > span { min-width:0; }
      .fig { grid-area:fig; margin-inline:7vmin 2vmin; }
      .fig img { position:absolute; inset:0; }
      .dimh span, .dimv span { font-size:1.5vmin; line-height:1.3; letter-spacing:.02em; }
      .dimh span span[lang], .dimv span span[lang] { position:static; transform:none; padding:0; background:none; width:auto; max-width:none; font:inherit; letter-spacing:inherit; color:inherit; }
      .dimh span { white-space:normal; text-align:center; width:max-content; max-width:95%; box-sizing:border-box; }
      .coord { max-width:100%; box-sizing:border-box; font-size:1.5vmin; letter-spacing:.02em; }
      .data { grid-area:data; gap:2vmin; container-type:inline-size; }
      .title { gap:3vmin; min-width:0; align-items:flex-start; }
      h1 { min-width:0; max-width:65%; font-size:min(7vmin,${(85 / longest).toFixed(2)}cqw); line-height:1.05; overflow-wrap:anywhere; }
      .ref { flex:1; min-width:0; font-size:1.5vmin; line-height:1.5; letter-spacing:.02em; text-align:end; }
      .ref b { font-size:2.8vmin; line-height:1.2; margin:.7vmin 0; }
      table { table-layout:fixed; margin:0; font-size:1.8vmin; line-height:1.4; letter-spacing:.02em; }
      tr.x { display:table-row; }
      td { white-space:normal; overflow-wrap:anywhere; padding:1vmin .6vmin; }
      td:first-child { display:table-cell; width:15%; font-size:1.5vmin; letter-spacing:.02em; }
      td:nth-child(2) { width:25%; font-size:1.5vmin; letter-spacing:.02em; }
      td:last-child { text-align:end; }
      .desc { display:block; max-width:100%; margin:0; font-size:1.8vmin; line-height:1.4; }
      .cta { margin:0; gap:2vmin; padding:1.8vmin 2vmin; font-size:2.3vmin; line-height:1.3; flex-wrap:wrap; }
      .cta span { display:inline; font-size:1.5vmin; line-height:1.3; letter-spacing:.02em; }
      .cta > span[lang] { font:inherit; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"doc doc" "fig data"; grid-template-columns:minmax(0,.38fr) minmax(0,.62fr); grid-template-rows:auto minmax(0,1fr); gap:7vmin 4vmin; }
        .data { justify-content:space-between; gap:2vmin; }
        .title { flex-direction:column; gap:1.5vmin; }
        h1 { max-width:100%; font-size:min(7vmin,${(125 / longest).toFixed(2)}cqw); }
        .ref { text-align:start; }
        .fig { margin-inline:5vmin 1vmin; }
        .dimv { left:-5vmin; }
        html[dir="rtl"] .dimv { left:auto; right:-5vmin; }
      }
      @media(min-aspect-ratio:6/5) {
        .title { flex-direction:row; }
        h1 { max-width:64%; font-size:min(7vmin,${(80 / longest).toFixed(2)}cqw); }
        .ref { text-align:end; }
      }
    `;
  }
  if (id === "skate-zine") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const longest = Math.max(...["Street", "Sessions"].flatMap(key => (copy[key] || key).split(/\s+/)).map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7))) * (["fa", "hy"].includes(lang) ? 1.4 : 1);
    const offerLength = Math.max(4, [...(copy["−25%"] || "−25%")].length);
    return `
      .banner { display:grid; grid-template-areas:"folio folio" "head head" "photo photo" "note hand"; grid-template-columns:minmax(0,1.6fr) minmax(0,1fr); grid-template-rows:auto auto minmax(0,1fr) auto; gap:4vmin; padding:5.6vmin 6vmin 5vmin; box-sizing:border-box; }
      .folio, .head, .riso, .cut, .note, .hand { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .folio { grid-area:folio; font-size:1.8vmin; line-height:1.3; letter-spacing:.03em; gap:3vmin; }
      .folio > span { min-width:0; }
      .head { grid-area:head; container-type:inline-size; line-height:1.05; }
      .head > span { font-size:min(14vmin,${(115 / longest).toFixed(2)}cqw); margin:0; overflow-wrap:anywhere; }
      .head > span + span { margin:0; margin-inline-start:8%; }
      .head span[lang] { font:inherit; display:inline; }
      .riso, .cut { grid-area:photo; }
      .riso { margin:2vmin -1vmin -1vmin 2vmin; }
      .cut { margin:0 1vmin 1vmin 0; }
      .cut img { position:absolute; inset:0; }
      .note { grid-area:note; align-self:end; }
      .note p { font-size:2.3vmin; line-height:1.4; }
      .note .cta { font-size:2.3vmin; line-height:1.35; margin-top:2vmin; }
      .hand { grid-area:hand; align-self:center; justify-self:center; padding:2vmin; max-width:100%; line-height:1.2; }
      .hand .big { font-size:min(8vmin,${(32 / offerLength).toFixed(2)}vmin); padding:0 1vmin; white-space:nowrap; }
      .hand .big bdi { font-size:inherit!important; }
      .hand .small { font-size:3vmin; line-height:1.3; }
      .hand .small b { white-space:nowrap; }
      .arrow { display:none; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"folio folio" "head photo" "hand photo" "note photo"; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:auto auto minmax(0,1fr) auto; gap:3vmin 4vmin; }
        .head > span { font-size:min(6vmin,${(150 / longest).toFixed(2)}cqw); }
        .head > span + span { margin:0; }
        .hand .big { font-size:min(7vmin,${(32 / offerLength).toFixed(2)}vmin); }
        .hand .small { font-size:2.6vmin; }
        .note p { font-size:2.5vmin; }
        .note .cta { font-size:2.1vmin; }
      }
      @media(min-aspect-ratio:6/5) {
        .banner { grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:2.5vmin 4vmin; }
        .head > span { font-size:min(9vmin,${(150 / longest).toFixed(2)}cqw); }
        .head > span + span { margin-inline-start:5%; }
        .hand { justify-self:end; padding:1vmin 3vmin; }
        .hand .big { font-size:min(6vmin,${(32 / offerLength).toFixed(2)}vmin); }
        .hand .small { display:inline; margin-inline-start:2vmin; }
      }
    `;
  }
  if (id === "ship-label") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const longest = Math.max(...(copy["Free express shipping"] || "Free express shipping").split(/\s+/).map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .banner { display:grid; grid-template-areas:"photo photo" "up stamp" "label label"; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:minmax(0,1fr) auto auto; gap:4vmin; padding:0 5vmin 5vmin; box-sizing:border-box; }
      .shot, .up, .stamp, .label { position:relative; inset:auto; min-width:0; max-width:100%; height:auto; width:auto; box-sizing:border-box; }
      .shot { grid-area:photo; margin-inline:-5vmin; max-width:none; min-height:0; }
      .shot img { position:absolute; inset:0; }
      .seam { display:none; }
      .up { grid-area:up; display:flex; font-size:1.7vmin; line-height:1.35; letter-spacing:.03em; align-self:center; }
      .up i { flex-shrink:0; }
      .stamp { grid-area:stamp; justify-self:end; align-self:center; font-size:min(3vmin,${(27 / [...(copy.FRAGILE || "FRAGILE")].length).toFixed(2)}vmin); line-height:1.2; letter-spacing:.02em; transform:rotate(-4deg); }
      .stamp small { font-size:1.4vmin; line-height:1.3; letter-spacing:.02em; }
      .label { grid-area:label; grid-template-columns:minmax(0,16%) minmax(0,84%); grid-template-rows:auto auto auto auto; container-type:inline-size; }
      .cls { font-size:7vmin; padding:1.5vmin 1vmin; }
      .cls small { max-width:100%; font-size:min(1.4vmin,${(12 / [...(copy.PRIORITY || "PRIORITY")].length).toFixed(2)}vmin); line-height:1.3; letter-spacing:.02em; text-align:center; overflow-wrap:anywhere; }
      .from { font-size:1.6vmin; padding:1.5vmin; gap:2vmin; flex-wrap:wrap; }
      .from > span { min-width:0; }
      .date { display:block; flex:1 1 auto; text-align:end; }
      .k { font-size:1.4vmin; line-height:1.3; letter-spacing:.03em; }
      .to { padding:2vmin; }
      h1 { font-size:min(6vmin,${(100 / longest).toFixed(2)}cqw); line-height:1.1; overflow-wrap:anywhere; }
      .to p { font-size:1.9vmin; line-height:1.5; }
      .to p b { white-space:nowrap; }
      .bars { padding:1.5vmin 2vmin; }
      .bars i { height:4vmin; }
      .bars span { font-size:1.4vmin; line-height:1.3; letter-spacing:.02em; gap:2vmin; }
      .bars > span > span { min-width:0; }
      .bars span[lang] { display:inline; }
      .cells { grid-template-columns:repeat(4,minmax(0,1fr)); }
      .cells > div { min-width:0; white-space:normal; font-size:1.7vmin; line-height:1.4; padding:1.5vmin 1.2vmin; overflow-wrap:anywhere; border-inline-end:.35vmin solid #121212; border-right:0; }
      .cells > div:last-child { border-inline-end:0; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"photo up stamp" "photo label label"; grid-template-columns:minmax(0,34%) minmax(0,1fr) minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); gap:4vmin 3vmin; padding:4vmin 4vmin 4vmin 0; }
        html[dir="rtl"] .banner { padding:4vmin 0 4vmin 4vmin; }
        .shot { margin:-4vmin 0; }
        .label { grid-template-rows:auto minmax(0,1fr) auto auto; }
        .from { flex-direction:column; gap:1vmin; }
        .date { text-align:start; }
        .cells { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .cells > div:nth-child(2) { border-inline-end:0; }
        .cells > div:nth-child(-n+2) { border-bottom:.35vmin solid #121212; }
      }
      @media(min-aspect-ratio:6/5) {
        .from { flex-direction:row; }
        .date { text-align:end; }
        .cells { grid-template-columns:repeat(4,minmax(0,1fr)); }
        .cells > div:nth-child(2) { border-inline-end:.35vmin solid #121212; }
        .cells > div:nth-child(-n+2) { border-bottom:0; }
      }
    `;
  }
  if (id === "sticker-bomb") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const longest = Math.max(...["Just", "Dropped"].flatMap(key => (copy[key] || key).split(/\s+/)).map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    const fresh = Math.max([...segmenter.segment(copy.NEW || "NEW")].length, [...(copy.NEW || "NEW")].length * .7);
    return `
      .banner { display:grid; grid-template-rows:minmax(0,1fr) auto; gap:5vmin; padding:6vmin; box-sizing:border-box; }
      .print { position:relative; inset:auto; width:100%; height:100%; min-height:0; min-width:0; }
      .print img { position:absolute; inset:1.6vmin; width:calc(100% - 3.2vmin); height:calc(100% - 3.2vmin); }
      .copy { position:relative; inset:auto; width:auto; height:auto; min-width:0; display:grid; grid-template-areas:"first first" "second second" "offer offer" "price barcode" "cta cta"; grid-template-columns:minmax(0,1fr) minmax(0,1.3fr); gap:4vmin; align-items:center; container-type:inline-size; }
      .copy > br { display:none; }
      .strip { max-width:100%; min-width:0; box-sizing:border-box; padding:1vmin 3vmin; line-height:1.1; font-size:min(10vmin,${(135 / longest).toFixed(2)}cqw); overflow-wrap:anywhere; }
      .s1 { grid-area:first; margin:0; justify-self:start; }
      .s2 { grid-area:second; margin:0; justify-self:end; }
      .masking, .price, .barcode, .cta { position:relative; inset:auto; min-width:0; max-width:100%; box-sizing:border-box; }
      .masking { grid-area:offer; font-size:3vmin; line-height:1.3; padding:1.7vmin 3vmin; }
      .price { grid-area:price; width:22vmin; height:22vmin; padding:2.7vmin; font-size:3.8vmin; line-height:1.2; justify-self:center; }
      .price small { max-width:100%; font-size:1.6vmin; line-height:1.3; letter-spacing:normal; }
      .barcode { grid-area:barcode; font-size:1.7vmin; line-height:1.35; letter-spacing:.02em; padding:1.5vmin; }
      .barcode i { width:100%; height:4vmin; }
      .cta { grid-area:cta; justify-self:end; font-size:2vmin; line-height:1.35; letter-spacing:.03em; padding:2vmin 3vmin; }
      .new { inset-inline-end:3vmin; inset-inline-start:auto; top:8vmin; width:20vmin; height:20vmin; padding:2.5vmin; box-sizing:border-box; font-size:min(5vmin,${(19 / fresh).toFixed(2)}vmin); line-height:1.1; }
      .new small { max-width:100%; font-size:1.5vmin; line-height:1.3; letter-spacing:normal; }
      .t3 { display:none; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-columns:minmax(0,44%) minmax(0,56%); grid-template-rows:minmax(0,1fr); gap:4vmin; padding:6vmin; }
        .copy { gap:2vmin; align-content:space-between; }
        .strip { font-size:min(8vmin,${(125 / longest).toFixed(2)}cqw); }
        .masking { font-size:2.5vmin; }
        .new { inset-inline-start:3vmin; inset-inline-end:auto; top:9vmin; }
        .t2 { inset-inline-start:28%; inset-inline-end:auto; }
        .price { width:18vmin; height:18vmin; font-size:3vmin; padding:2vmin; }
        .price small { font-size:1.4vmin; }
        .barcode { font-size:1.4vmin; }
      }
    `;
  }
  if (id === "raffle-drop") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const longest = Math.max(...["Enter the", "draw"].flatMap(key => (copy[key] || key).split(/\s+/)).map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7))) * (["ja", "ko", "zh", "zh-Hant"].includes(lang) ? 1.6 : 1);
    return `
      .banner { display:grid; grid-template-rows:minmax(0,1fr) auto; }
      .shot, .panel { position:relative; inset:auto; width:100%; height:auto; min-height:0; min-width:0; }
      .shot img { position:absolute; inset:0; }
      .tag { inset-inline-start:3vmin; inset-inline-end:auto; max-width:43%; box-sizing:border-box; font-size:1.8vmin; letter-spacing:.03em; }
      .tag i { flex-shrink:0; }
      .count { inset-inline-end:3vmin; inset-inline-start:auto; max-width:43%; box-sizing:border-box; font-size:1.8vmin; letter-spacing:.03em; text-align:end; }
      .inner { padding:3vmin 4vmin 4vmin; gap:2vmin; container-type:inline-size; }
      .strip { height:5vmin; font-size:1.8vmin; letter-spacing:.03em; }
      .strip span { padding-inline-start:3vmin; padding-inline-end:0; }
      .meta { min-width:0; font-size:1.8vmin; line-height:1.35; letter-spacing:.03em; gap:2vmin; }
      .meta > span { min-width:0; }
      h1 { margin:0; white-space:normal; font-size:min(9vmin,${(140 / longest).toFixed(2)}cqw); line-height:1.1; overflow-wrap:anywhere; }
      .clock { margin:0; gap:1.5vmin; grid-template-columns:repeat(4,minmax(0,1fr)); }
      .clock div { min-width:0; }
      .clock b { height:10vmin; line-height:10vmin; font-size:7vmin; }
      .clock b .reel i { height:10vmin; }
      .clock small { font-size:1.7vmin; line-height:1.25; letter-spacing:.02em; overflow-wrap:anywhere; }
      .steps { display:block; margin:0; font-size:1.8vmin; line-height:1.35; letter-spacing:.02em; }
      .steps li { padding:1vmin 0; gap:1.5vmin; min-width:0; }
      .steps b { flex-shrink:0; }
      .ticket { margin:0; height:auto; min-height:9vmin; }
      .stub { min-width:0; width:36%; height:auto; padding:1.4vmin 2vmin; font-size:2vmin; line-height:1.35; letter-spacing:.02em; }
      .stub small { font-size:1.7vmin; line-height:1.3; letter-spacing:.02em; }
      .go { min-width:0; height:auto; padding:1.4vmin 2vmin; gap:1vmin; font-size:2.7vmin; line-height:1.3; letter-spacing:.02em; }
      .go span[lang] { font:inherit; animation:none; }
      .go > span:not([lang]) { flex-shrink:0; font-size:3vmin; }
      html[dir="rtl"] .ticket { direction:ltr; }
      html[dir="rtl"] .stub, html[dir="rtl"] .go { direction:rtl; }
      html[dir="rtl"] .strip .run { animation-name:raffle-crawl-rtl; }
      @keyframes raffle-crawl-rtl { from { transform:translateX(0); } to { transform:translateX(25%); } }
      @media(min-aspect-ratio:7/10) {
        .banner { grid-template-columns:minmax(0,40%) minmax(0,60%); grid-template-rows:minmax(0,1fr); }
        .tag { max-width:calc(40% - 6vmin); }
        .count { inset-inline-start:3vmin; inset-inline-end:auto; top:14vmin; max-width:calc(40% - 6vmin); text-align:start; }
        .inner { justify-content:space-between; gap:2vmin; }
        .meta { flex-direction:column; gap:.7vmin; }
        h1 { font-size:min(8vmin,${(140 / longest).toFixed(2)}cqw); }
        .ticket { flex-direction:row; }
        .stub { border-bottom:0; border-right:.45vmin dashed #0E0E0E; mask:none; }
        .go { mask:none; }
      }
      @media(min-aspect-ratio:6/5) {
        .banner { grid-template-columns:minmax(0,40%) minmax(0,60%); }
        .inner { padding:2vmin 3vmin 3vmin; gap:1.2vmin; }
        .meta { flex-direction:row; }
        h1 { font-size:min(7vmin,${(140 / longest).toFixed(2)}cqw); }
        .steps li { padding:.7vmin 0; }
        .clock b { height:8vmin; line-height:8vmin; font-size:6vmin; }
        .clock b .reel i { height:8vmin; }
      }
    `;
  }
  if (id === "swiss") {
    const text = copy["New Season"] || "New Season";
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const longest = Math.max(...text.split(/\s+/).map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7))) * (["ja", "ko", "zh", "zh-Hant"].includes(lang) ? 1.6 : 1);
    return `
      .photo { width:45%; inset-inline-end:0; inset-inline-start:auto; }
      .col { inset-inline-start:5vmin; inset-inline-end:auto; width:calc(55% - 10vmin); top:5vmin; bottom:5vmin; container-type:inline-size; }
      .meta { min-width:0; font-size:1.7vmin; line-height:1.3; gap:1.4vmin; }
      .meta > span { min-width:0; overflow-wrap:anywhere; }
      h1 { max-width:100%; margin-top:3vmin; color:#9A5B2E; font-size:min(9vmin,${(145 / longest).toFixed(2)}cqw); line-height:1.1; letter-spacing:-.03em; overflow-wrap:anywhere; }
      h1 .ln { max-width:100%; }
      .lede { margin-top:2.5vmin; font-size:2.3vmin; line-height:1.35; }
      .index { padding-top:2vmin; }
      .index div { min-width:0; font-size:2.3vmin; line-height:1.3; gap:1.5vmin; padding:1.2vmin 0; }
      .index div > span:not([lang]) { flex-shrink:0; }
      .index div > span[lang] { width:auto; min-width:0; font:inherit; color:inherit; }
      .foot { margin-top:2.5vmin; align-items:flex-end; flex-wrap:wrap; gap:2vmin; }
      .season { display:flex; flex-direction:column; gap:.8vmin; font-size:${["fa", "ne", "am"].includes(lang) ? "3" : "8"}vmin; line-height:1; max-width:100%; }
      .season sup { font-size:1.7vmin; line-height:1.3; vertical-align:baseline; margin:0; letter-spacing:normal; }
      .cta { min-width:0; max-width:100%; white-space:normal; font-size:2vmin; line-height:1.3; overflow-wrap:anywhere; }
      .tag { inset-inline-end:3vmin; inset-inline-start:auto; max-width:calc(45% - 6vmin); box-sizing:border-box; font-size:1.8vmin; line-height:1.3; letter-spacing:.03em; }
      @media(min-aspect-ratio:6/5) {
        .photo { width:48%; }
        .col { width:calc(52% - 10vmin); }
        h1 { margin-top:2vmin; font-size:min(8vmin,${(145 / longest).toFixed(2)}cqw); }
        .lede { margin-top:2vmin; }
        .season { font-size:${["fa", "ne", "am"].includes(lang) ? "3" : "7"}vmin; }
        .tag { max-width:calc(48% - 6vmin); }
      }
    `;
  }
  if (id === "street-diary") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const longest = Math.max(...["Street", "Diary"].flatMap(key => (copy[key] || key).split(/\s+/)).map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7))) * (["ja", "ko", "zh", "zh-Hant"].includes(lang) ? 1.5 : 1);
    return `
      .banner { display:grid; grid-template-areas:"head" "main" "caption" "dets" "foot"; grid-template-rows:auto minmax(0,1fr) auto minmax(0,.55fr) auto; gap:2.5vmin; padding:4vmin 5vmin; box-sizing:border-box; }
      .head, .main, .cap.c0, .dets, .foot { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .head { grid-area:head; container-type:inline-size; gap:3vmin; }
      .head h1 { max-width:70%; font-size:min(9vmin,${(115 / longest).toFixed(2)}cqw); line-height:1.05; overflow-wrap:anywhere; }
      .head .vol { min-width:0; max-width:40%; font-size:1.8vmin; text-align:end; letter-spacing:.03em; }
      .main { grid-area:main; }
      .stamp { max-width:calc(100% - 5.2vmin); font-size:2.5vmin; line-height:1.3; letter-spacing:.03em; overflow-wrap:anywhere; text-align:end; }
      .cap.c0 { grid-area:caption; }
      .cap { white-space:normal; align-items:flex-start; gap:1.3vmin; }
      .cap > span { min-width:0; }
      .cap > span:last-child { flex-shrink:0; }
      .cap > span:first-child span[lang] { color:inherit; }
      .cap b { margin:0; margin-inline-end:1vmin; }
      .dets { grid-area:dets; }
      .det { min-width:0; }
      .det .cap { font-size:1.7vmin; }
      .foot { grid-area:foot; font-size:1.8vmin; line-height:1.35; letter-spacing:.04em; gap:3vmin; }
      .foot > span, .foot > b { min-width:0; }
      .foot > b { max-width:58%; }
      .foot b i { flex-shrink:0; }
      .foot b span[lang] { display:inline; }
      html[dir="rtl"] .foot b i { transform:rotate(180deg); }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"main head" "main dets" "main foot"; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:auto minmax(0,1fr) auto; gap:3vmin 4vmin; }
        .head { flex-direction:column; align-items:flex-start; gap:1.5vmin; }
        .head h1 { max-width:100%; font-size:min(7vmin,${(140 / longest).toFixed(2)}cqw); }
        .head .vol { max-width:100%; text-align:start; font-size:1.7vmin; }
        .cap.c0 { display:none; }
        .dets { grid-template-columns:minmax(0,1fr); grid-template-rows:repeat(2,minmax(0,1fr)); gap:2.4vmin; }
        .foot > span { display:none; }
        .foot > b { max-width:100%; }
      }
      @media(min-aspect-ratio:6/5) {
        .banner { grid-template-columns:minmax(0,1fr) minmax(0,1.3fr); }
        .head { flex-direction:row; align-items:flex-end; gap:3vmin; }
        .head h1 { max-width:66%; font-size:min(9vmin,${(115 / longest).toFixed(2)}cqw); }
        .head .vol { max-width:40%; text-align:end; }
        .dets { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:minmax(0,1fr); gap:3vmin; }
        .foot > span { display:inline; }
        .foot > b { max-width:58%; }
      }
    `;
  }
  if (id === "editors-letter") {
    return `
      .banner { box-sizing:border-box; display:grid; grid-template-areas:"top" "photo" "letter"; grid-template-rows:auto minmax(0,1fr) auto; gap:3vmin; padding:4vmin 0 5vmin; }
      .top, .photo, .letter { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .top { grid-area:top; margin:0 6vmin; gap:3vmin; font-size:1.8vmin; line-height:1.3; letter-spacing:.06em; }
      .top > span { min-width:0; }
      .top > span > span[lang] { display:inline; }
      .photo { grid-area:photo; width:100%; height:100%; object-fit:cover; }
      .letter { grid-area:letter; margin:0 7vmin; }
      .dear { font-size:4.5vmin; line-height:1.2; margin-bottom:2vmin; }
      .body { font-size:2.6vmin; line-height:1.45; max-width:100%; }
      .body::first-letter { float:none; font-size:inherit; line-height:inherit; padding:0; }
      .sign { min-width:0; max-width:100%; gap:2vmin; flex-wrap:wrap; margin-top:3vmin; padding-inline:2vmin; box-sizing:border-box; }
      .sig { max-width:100%; font-size:8vmin; white-space:normal; line-height:1.2; margin:0; }
      .role { max-width:100%; font-size:1.8vmin; letter-spacing:.05em; text-align:end; padding:0; }
      .role > span[lang] { display:inline; font-weight:600; color:inherit; }
      .ps { max-width:100%; font-size:2.4vmin; line-height:1.45; overflow-wrap:anywhere; }
      .ps b { display:inline-block; font-size:2vmin; letter-spacing:.06em; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"photo top" "photo letter"; grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr); grid-template-rows:auto minmax(0,1fr); gap:3vmin 5vmin; padding:4vmin 0; }
        .photo { margin-top:-4vmin; height:calc(100% + 8vmin); }
        .top { margin:0; margin-inline-end:5vmin; }
        .top > span:last-child { display:none; }
        .letter { margin:0; margin-inline-end:5vmin; justify-content:center; }
        .dear { font-size:3.8vmin; }
        .body { font-size:2.2vmin; }
        .sig { font-size:6vmin; }
        .role { font-size:1.7vmin; }
        .ps { font-size:2.1vmin; }
      }
      @media(min-aspect-ratio:6/5) {
        .banner { grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr); }
        .top > span:last-child { display:inline; }
        .body { font-size:2.6vmin; }
        .sign { margin-top:2vmin; }
        .sig { font-size:8vmin; }
        .ps { margin-top:1vmin; }
      }
    `;
  }
  if (id === "cut-zine") {
    const text = copy["New Drop"] || "New Drop";
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const longest = Math.max(...text.split(/\s+/).map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .banner { box-sizing:border-box; display:grid; grid-template-areas:"shot shot" "cut cut" "type note"; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr); grid-template-rows:minmax(0,1fr) auto auto; gap:5vmin 4vmin; padding:7vmin 6vmin 6vmin; }
      .shot, .cut, .type, .note { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .shot { grid-area:shot; }
      .cut { grid-area:cut; container-type:inline-size; flex-direction:row; gap:2vmin 4vmin; }
      .cut .word { max-width:100%; flex-wrap:wrap; }
      .cut .word:empty { display:none; }
      .cut .word + .word { margin:0; }
      .l { zoom:1 !important; font-size:min(11vmin,${(85 / longest).toFixed(2)}cqw); padding:.03em .12em .05em; }
      .cut > bdi { font-size:min(8vmin,${(150 / longest).toFixed(2)}cqw) !important; line-height:1.2 !important; overflow-wrap:anywhere; }
      .type { grid-area:type; font-size:2.3vmin; line-height:1.4; overflow-wrap:anywhere; }
      .note { grid-area:note; align-self:center; font-size:3.8vmin; line-height:1.2; overflow-wrap:anywhere; }
      .note svg { max-width:90%; }
      .stamp { box-sizing:border-box; padding:1vmin; }
      .stamp small { max-width:100%; font-size:1.6vmin; line-height:1.2; text-align:center; letter-spacing:.03em; overflow-wrap:anywhere; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"shot cut" "shot type" "shot note"; grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); grid-template-rows:auto minmax(0,1fr) auto; gap:5vmin; padding:6vmin 5vmin; }
        .cut { flex-direction:column; align-self:start; align-items:flex-start; }
        .cut > bdi { font-size:min(6vmin,${(150 / longest).toFixed(2)}cqw) !important; }
        .l { font-size:min(7vmin,${(85 / longest).toFixed(2)}cqw); }
        .type { align-self:center; font-size:2vmin; }
        .note { font-size:3.5vmin; }
        .stamp { inset-inline-start:7vmin; inset-inline-end:auto; }
      }
      @media(min-aspect-ratio:6/5) {
        .banner { grid-template-columns:minmax(0,1fr) minmax(0,1.2fr); gap:4vmin 8vmin; }
        .cut { flex-direction:row; }
        .l { font-size:min(9vmin,${(85 / longest).toFixed(2)}cqw); }
        .type { font-size:3vmin; }
        .cut > bdi { font-size:min(8vmin,${(150 / longest).toFixed(2)}cqw) !important; }
        .note { font-size:3.8vmin; }
      }
    `;
  }
  if (id === "the-five") {
    const title = copy["The Five"] || "The Five";
    const length = Math.max([...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(title)].length, [...title].length * .7) * (["ja", "ko", "zh", "zh-Hant"].includes(lang) ? 2 : 1);
    return `
      .banner { display:grid; grid-template-areas:"kick kick" "title title" "list photo" "bar bar"; grid-template-columns:minmax(0,1fr) minmax(0,1.1fr); grid-template-rows:auto auto minmax(0,1fr) auto; gap:2vmin 3vmin; padding-top:4vmin; box-sizing:border-box; }
      .kick, .title, .list, .photo, .bar { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .kick { grid-area:kick; margin:0 5vmin; gap:2vmin; font-size:1.7vmin; line-height:1.3; letter-spacing:.07em; }
      .kick > span { min-width:0; }
      .title { grid-area:title; margin:0 5vmin; container-type:inline-size; gap:2vmin; align-items:center; white-space:normal; }
      .title h1 { max-width:72%; font-size:min(15vmin,${(125 / length).toFixed(2)}cqw); line-height:1.1; letter-spacing:-.03em; overflow-wrap:anywhere; }
      .title p { min-width:0; margin:0; font-size:3.4vmin; line-height:1.2; }
      .photo { grid-area:photo; width:100%; height:100%; object-fit:cover; }
      .list { grid-area:list; margin-inline-start:5vmin; grid-template-rows:repeat(5,minmax(0,1fr)); gap:1vmin; }
      .i { min-width:0; min-height:0; padding-top:1vmin; overflow-wrap:anywhere; }
      .i .n { font-size:1.9vmin; line-height:1.15; }
      .i .t { font-size:3vmin; line-height:1.15; }
      .i .d { font-size:2vmin; line-height:1.25; }
      .bar { grid-area:bar; min-height:13vmin; padding:2vmin 5vmin; gap:3vmin; }
      .bar .off { min-width:0; font-size:5vmin; line-height:1.2; }
      .bar .off > span:not([lang]) { font-size:2.6vmin; margin-inline-start:1vmin; }
      .bar .off > span[lang] { font:inherit; margin:0; letter-spacing:inherit; }
      .bar .off > span > span[lang] { font:inherit; margin:0; letter-spacing:inherit; }
      html[dir="rtl"] .bar .off bdi { font-size:inherit; }
      .bar .code { flex-shrink:0; max-width:40%; font-size:1.7vmin; letter-spacing:.04em; text-align:end; overflow-wrap:anywhere; }
      .bar .code b { letter-spacing:.08em; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"kick photo" "title photo" "list photo" "bar photo"; grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); gap:1.6vmin 3vmin; }
        .photo { margin-top:-4vmin; height:calc(100% + 4vmin); }
        .kick { margin-inline-end:0; }
        .kick > span:last-child { display:none; }
        .kick span[lang] { display:inline; }
        .title { flex-direction:column; align-items:flex-start; gap:.8vmin; margin-inline-end:0; }
        .title h1 { max-width:100%; font-size:min(8vmin,${(175 / length).toFixed(2)}cqw); }
        .title p { font-size:2.5vmin; }
        .title p br { display:none; }
        .i { padding-top:.7vmin; }
        .i .t { font-size:2.5vmin; margin-top:.4vmin; }
        .i .d { font-size:1.8vmin; margin-top:.4vmin; }
        .bar { min-height:12vmin; padding:1.8vmin 3vmin; gap:1.5vmin; }
        .bar .off { font-size:4.2vmin; }
        .bar .off > span:not([lang]) { display:block; font-size:2.2vmin; margin:0; }
        .bar .code { font-size:1.5vmin; }
      }
      @media(min-aspect-ratio:6/5) {
        .banner { grid-template-areas:"photo kick" "photo title" "photo list" "photo bar"; grid-template-columns:minmax(0,.8fr) minmax(0,1.8fr); }
        .kick { margin:0; margin-inline-end:5vmin; }
        .kick > span:last-child { display:inline; }
        .title { flex-direction:row; align-items:center; gap:3vmin; margin:0; margin-inline-end:5vmin; }
        .title h1 { max-width:72%; font-size:min(10vmin,${(125 / length).toFixed(2)}cqw); }
        .title p { font-size:3vmin; }
        .list { margin:0; margin-inline-end:5vmin; grid-template-rows:none; grid-template-columns:repeat(5,minmax(0,1fr)); gap:2vmin; }
        .i .t { font-size:2.8vmin; }
        .i .d { font-size:2vmin; }
        .bar { margin-inline-start:-3vmin; }
        .bar .off > span:not([lang]) { display:inline; margin-inline-start:1vmin; }
      }
    `;
  }
  if (id === "folio-spread") {
    return `
      .banner { display:grid; grid-template-areas:"photo photo" "folio copy" "look copy"; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); grid-template-rows:minmax(0,1fr) auto auto; gap:2vmin 3vmin; padding-bottom:5vmin; box-sizing:border-box; }
      .photo, .folio, .look, .copy { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; box-sizing:border-box; }
      .photo { grid-area:photo; width:100%; height:100%; object-fit:cover; }
      .folio { grid-area:folio; align-self:end; margin-inline-start:4vmin; font-size:20vmin; line-height:1.2; letter-spacing:-.03em; }
      .look { grid-area:look; margin-inline-start:5vmin; font-size:1.8vmin; line-height:1.3; letter-spacing:.05em; }
      .copy { grid-area:copy; margin-inline-end:5vmin; padding-top:2vmin; gap:1.8vmin; }
      .kick { font-size:1.8vmin; line-height:1.3; letter-spacing:.06em; }
      .cap { font-size:2.9vmin; line-height:1.25; }
      .cred { grid-template-columns:minmax(0,auto) minmax(0,1fr); font-size:1.8vmin; line-height:1.35; gap:.7vmin 1.5vmin; }
      .cred dt { letter-spacing:.04em; }
      .cred dt, .cred dd { min-width:0; overflow-wrap:anywhere; }
      .cta { font-size:1.8vmin; line-height:1.3; letter-spacing:.06em; }
      .cta i { flex-shrink:0; width:5vmin; }
      .crop { position:relative; inset:auto; grid-row:2; align-self:start; }
      .crop.a { grid-column:1; margin-inline-start:1.6vmin; }
      .crop.b { grid-column:2; justify-self:end; margin-inline-end:1.6vmin; }
      .crop.a, .crop.b { inset:auto; }
      .reg { display:none; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"photo folio" "photo look" "photo copy"; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); grid-template-rows:auto auto minmax(0,1fr); gap:2vmin 4vmin; padding-bottom:0; }
        .folio { margin:0; margin-block-start:3vmin; margin-inline-end:4vmin; font-size:20vmin; }
        .look { margin:0; margin-inline-end:4vmin; }
        .copy { margin:0; margin-inline-end:4vmin; margin-block-end:4vmin; padding:0; justify-content:space-between; }
        .cap { font-size:2.7vmin; }
        .cred { font-size:1.7vmin; }
        .crop { display:none; }
      }
      @media(min-aspect-ratio:6/5) {
        .banner { grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:1.5vmin 5vmin; }
        .folio { font-size:23vmin; }
        .copy { gap:1.5vmin; }
        .cap { font-size:2.8vmin; }
      }
    `;
  }
  if (id === "broadsheet") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const width = text => Math.max([...segmenter.segment(text)].length, [...text].length * .7) * (["ja", "ko", "zh", "zh-Hant"].includes(lang) ? 1.6 : 1);
    const mast = width(copy["The Daily Edit"] || "The Daily Edit") * (["am", "lo"].includes(lang) ? 1.5 : 1);
    const longest = Math.max(...["Sale", "Extended"].flatMap(key => (copy[key] || key).split(/\s+/)).map(width));
    return `
      .banner { display:grid; grid-template-areas:"top" "date" "head" "photo" "cap" "cols" "foot"; grid-template-rows:auto auto auto minmax(0,1fr) auto auto auto; gap:2vmin; padding:3.6vmin 4.5vmin; box-sizing:border-box; }
      .top, .date, .head, .photo, .cap, .cols, .foot { position:relative; inset:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; margin:0; box-sizing:border-box; }
      .top { grid-area:top; container-type:inline-size; grid-template-columns:17vmin minmax(0,1fr) 17vmin; gap:1vmin; }
      .ear { min-width:0; overflow-wrap:anywhere; letter-spacing:.03em; }
      .ear b { font-size:1.9vmin; }
      .mast { min-width:0; white-space:normal; font-size:min(9vmin,${(95 / mast).toFixed(2)}cqw); line-height:1.1; overflow-wrap:anywhere; }
      .date { grid-area:date; gap:1.5vmin; font-size:1.65vmin; line-height:1.3; letter-spacing:.02em; white-space:normal; align-items:center; }
      .date > span { min-width:0; }
      .date > span:nth-child(2) { text-align:center; }
      .head { grid-area:head; container-type:inline-size; text-align:center; }
      .head h1 { font-size:min(8vmin,${(135 / longest).toFixed(2)}cqw); line-height:1.12; overflow-wrap:anywhere; }
      .head h1 br { display:none; }
      .head p { max-width:100%; font-size:2.6vmin; line-height:1.3; margin:1vmin 0 0; }
      .photo { grid-area:photo; width:100%; height:100%; object-fit:cover; }
      .cap { grid-area:cap; font-size:1.8vmin; line-height:1.35; padding-bottom:1vmin; }
      .cap b { letter-spacing:.03em; }
      .cols { grid-area:cols; column-count:3; column-fill:balance; column-gap:3vmin; font-size:1.95vmin; line-height:1.4; overflow:visible; overflow-wrap:anywhere; }
      .cols p:first-child::first-letter { float:none; font-size:inherit; line-height:inherit; padding:0; }
      .cols .code { box-sizing:border-box; max-width:100%; break-inside:avoid; letter-spacing:.02em; padding:.8vmin .4vmin; line-height:1.25; }
      .foot { grid-area:foot; font-size:1.7vmin; line-height:1.3; letter-spacing:.03em; gap:2vmin; }
      .foot b { letter-spacing:.03em; }
      .foot b span[lang] { display:inline; }
      @media(min-aspect-ratio:9/10) {
        .banner { grid-template-areas:"top top" "date date" "photo head" "photo cols" "cap foot"; grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr); grid-template-rows:auto auto auto minmax(0,1fr) auto; gap:2vmin 3vmin; }
        .head { text-align:start; }
        .head h1 { font-size:min(5.5vmin,${(140 / longest).toFixed(2)}cqw); }
        .head h1 br { display:block; }
        .head p { font-size:2.2vmin; }
        .cols { column-count:2; font-size:${lang === "hy" ? 1.65 : 1.8}vmin; }
        .cap { align-self:end; border:0; padding:0; }
        .foot { align-self:end; }
        .foot span:first-child { display:none; }
      }
      @media(min-aspect-ratio:6/5) {
        .banner { grid-template-areas:"top top" "date date" "head photo" "cols photo" "foot cap"; grid-template-columns:minmax(0,1.25fr) minmax(0,1fr); }
        .cols { column-count:3; }
        .head h1 br { display:none; }
        .foot span:first-child { display:inline; }
      }
    `;
  }
  if (id === "stable-plaque") {
    const text = copy.COUNTRY || "COUNTRY";
    const longest = Math.max(...text.split(/\s+/).map(word => Math.max([...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(word)].length, [...word].length * .7))) * (["ja", "ko", "zh", "zh-Hant"].includes(lang) ? 1.6 : 1);
    return `
      .plate { container-type:inline-size; }
      .name { font-size:min(7.8vmin,${(120 / longest).toFixed(2)}cqw); letter-spacing:.04em; margin-right:0; line-height:1.15; overflow-wrap:anywhere; }
      .stall { letter-spacing:.08em; margin-right:0; line-height:1.2; }
      .ped { font-size:2.3vmin; line-height:1.25; }
      .copy { gap:1.2vmin; }
      .t { font-size:2.8vmin; line-height:1.25; }
      .o { white-space:normal; font-size:1.9vmin; letter-spacing:.04em; line-height:1.3; margin:0; }
      .cta { max-width:100%; white-space:normal; font-size:1.9vmin; letter-spacing:.05em; line-height:1.25; margin-top:1vmin; }
      .cta i { flex-shrink:0; }
      @media(min-aspect-ratio:9/10) and (max-aspect-ratio:6/5) { .name { font-size:min(5.5vmin,${(120 / longest).toFixed(2)}cqw); } .ped { font-size:2.1vmin; } }
    `;
  }
  if (id === "ex-libris") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const longest = key => Math.max(...(copy[key] || key).split(/\s+/).map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .hd, .txt { container-type:inline-size; width:100%; min-width:0; }
      .ex { max-width:100%; white-space:normal; gap:1vmin; font-size:min(4.4vmin,${(100 / longest("Ex Libris")).toFixed(2)}cqw); letter-spacing:.03em; margin-right:0; line-height:1.15; }
      .ex > span { min-width:0; overflow-wrap:anywhere; }
      .ex svg { width:3vmin; height:2vmin; }
      .of { max-width:100%; white-space:normal; font-size:2.2vmin; line-height:1.25; }
      h1 { max-width:100%; font-size:min(6vmin,${(135 / longest("The Autumn Volume")).toFixed(2)}cqw); white-space:normal; line-height:1.15; overflow-wrap:anywhere; }
      .sub { max-width:100%; font-size:2.4vmin; line-height:1.3; }
      .rule { max-width:100%; }
      .deal { max-width:100%; flex-wrap:wrap; justify-content:center; gap:1.8vmin; white-space:normal; }
      .deal b { max-width:100%; font-size:4.2vmin; line-height:1.2; }
      .deal > span { box-sizing:border-box; max-width:100%; font-size:2vmin; letter-spacing:.05em; }
      .deal span[lang] { display:inline; font:inherit; padding:0; border:0; outline:0; margin:0; letter-spacing:normal; }
      .fine { max-width:100%; white-space:normal; font-size:1.8vmin; line-height:1.3; overflow-wrap:anywhere; }
      @media(min-aspect-ratio:9/10) { .sub { font-size:2.2vmin; } }
    `;
  }
  if (id === "cut-collage") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const words = (copy["Just landed"] || "Just landed").split(/\s+/);
    const longest = Math.max(...words.map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .side, .hl { container-type:inline-size; }
      .hl { --L:5vmin; max-width:100%; }
      .hl > bdi { font-size:min(6vmin,${(135 / longest).toFixed(2)}cqw) !important; line-height:1.2 !important; overflow-wrap:anywhere; }
      .w { max-width:100%; flex-wrap:wrap; }
      .strip { box-sizing:border-box; max-width:100%; line-height:1.3; }
      .strip small { letter-spacing:.04em; }
      .strip span[lang], .price span[lang] { display:inline; font:inherit; margin:0; color:inherit; letter-spacing:normal; }
      .price { max-width:100%; box-sizing:border-box; font-size:4.6vmin; line-height:1.2; white-space:nowrap; }
      .tape { box-sizing:border-box; max-width:100%; white-space:normal; overflow-wrap:anywhere; letter-spacing:.04em; line-height:1.25; }
      @media(max-aspect-ratio:7/10) {
        .banner { display:grid; grid-template-rows:auto minmax(0,1fr) auto; padding:5vmin 6vmin; gap:4vmin; }
        .side { display:contents; }
        .hl { grid-row:1; --L:8vmin; }
        .photo { grid-row:2; position:relative; inset:auto; width:100%; height:100%; min-height:0; }
        .lower { grid-row:3; min-width:0; }
        .strip { font-size:2.6vmin; }
      }
      @media(min-aspect-ratio:7/10) and (max-aspect-ratio:6/5) {
        .side { gap:4vmin; }
        .price { font-size:4vmin; }
      }
      @media(min-aspect-ratio:6/5) { .hl { --L:8vmin; } }
    `;
  }
  if (id === "gaffer-tape") {
    const text = copy["40% off"] || "40% off";
    const length = Math.max([...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(text)].length, [...text].length * .7) * (["ja", "ko", "zh", "zh-Hant"].includes(lang) ? 1.5 : 1);
    return `
      .floor { container-type:inline-size; box-sizing:border-box; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:2.6vmin; padding:5vmin; }
      .tp { position:relative; left:auto; right:auto; top:auto; bottom:auto; box-sizing:border-box; max-width:100%; white-space:normal; line-height:1.2; overflow-wrap:anywhere; flex-shrink:0; }
      .t1 { max-width:74%; font-size:4.6vmin; }
      .t2 { font-size:min(13vmin,${(125 / length).toFixed(2)}cqw); padding:1.5vmin 3vmin; white-space:nowrap; }
      .t3 { font-size:3vmin; }
      .t4 { align-self:flex-end; font-size:2.5vmin; letter-spacing:.05em; }
      .t5 { font-size:1.6vmin; letter-spacing:.05em; }
      .tm { top:4vmin; right:4vmin; width:10vmin; height:10vmin; }
      .tm i:nth-child(2) { height:8vmin; }
      .tm b { left:auto; right:0; top:9vmin; font-size:2.8vmin; }
      .xm { opacity:.3; }
      @media(min-aspect-ratio:7/10) and (max-aspect-ratio:9/10) { .floor { gap:2.6vmin; padding-block:3vmin; } .t1 { font-size:3.8vmin; transform:rotate(-1deg); } .t2 { font-size:min(10vmin,${(110 / length).toFixed(2)}cqw); transform:rotate(1deg); } .t3 { transform:rotate(-1deg); } .t4 { transform:rotate(1deg); } }
      @media(min-aspect-ratio:9/10) { .floor { padding-block:8vmin; } .t1 { max-width:100%; font-size:3.6vmin; } .t2 { font-size:min(11vmin,${(120 / length).toFixed(2)}cqw); } .t3 { font-size:2.6vmin; } .tm { top:2.8vmin; right:4vmin; transform:scale(.6); transform-origin:top right; } }
      @media(min-aspect-ratio:6/5) { .floor { gap:2.4vmin; } .t1 { font-size:4.4vmin; } .t3 { font-size:3vmin; } }
      html[dir="rtl"] .tp { text-align:right; }
    `;
  }
  if (id === "missing-piece") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const words = (copy["The missing piece."] || "The missing piece.").split(/\s+/);
    const longest = Math.max(...words.map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .txt { container-type:inline-size; width:100%; }
      h1 { font-size:min(5.5vmin,${(140 / longest).toFixed(2)}cqw); line-height:1.16; overflow-wrap:anywhere; }
      .k { letter-spacing:.06em; }
      .sub { font-size:2.1vmin; line-height:1.35; }
      .foot p { min-width:0; }
      .cta { max-width:40%; white-space:normal; box-sizing:border-box; overflow-wrap:anywhere; }
      @media(min-aspect-ratio:9/10) and (max-aspect-ratio:6/5) {
        .banner { --p:24vmin; }
        .copy { gap:2vmin; }
        h1 { font-size:min(4.6vmin,${(140 / longest).toFixed(2)}cqw); }
        .sub { font-size:1.9vmin; }
        .cta { max-width:100%; }
      }
    `;
  }
  if (id === "bandana-paisley") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const words = (copy["Tie it on."] || "Tie it on.").split(/\s+/);
    const longest = Math.max(...words.map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .med { container-type:inline-size; }
      .med > * { max-width:100%; box-sizing:border-box; }
      .k { white-space:normal; letter-spacing:.05em; line-height:1.2; }
      .k::before, .k::after { flex-shrink:0; }
      h1 { font-size:min(8vmin,${(125 / longest).toFixed(2)}cqw); white-space:normal; line-height:1.15; overflow-wrap:anywhere; }
      .script { font-size:3.6vmin; white-space:normal; line-height:1.2; }
      .offer { flex-wrap:wrap; justify-content:center; gap:1.2vmin; white-space:normal; letter-spacing:.04em; }
      .offer > * { max-width:100%; box-sizing:border-box; }
      .offer b { font-size:3.6vmin; line-height:1.2; }
      .cta { white-space:normal; letter-spacing:.05em; line-height:1.2; }
      @media(min-aspect-ratio:9/10) and (max-aspect-ratio:6/5) {
        .med { left:calc(var(--rim) + var(--bd) + 1.5vmin); right:calc(var(--rim) + var(--bd) + 1.5vmin); }
        .script { font-size:2.8vmin; }
        .offer b { font-size:3vmin; }
      }
      @media(min-aspect-ratio:9/10) {
        html[dir="rtl"] .photo { left:auto; right:0; }
        html[dir="rtl"] .cloth { left:0; right:45%; }
      }
      @media(min-aspect-ratio:6/5) { html[dir="rtl"] .cloth { right:48%; } }
    `;
  }
  if (id === "flacon-window") {
    const text = copy.SAISON || "SAISON";
    const length = Math.max([...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(text)].length, [...text].length * .7);
    return `
      .head { container-type:inline-size; }
      h1 { font-size:min(7vmin,${(150 / length).toFixed(2)}cqw); letter-spacing:.1em; margin-right:0; line-height:1.12; overflow-wrap:anywhere; }
      .sub { font-size:2.5vmin; line-height:1.25; }
      .offer { font-size:3.5vmin; line-height:1.15; }
      .meta { white-space:normal; letter-spacing:.06em; }
      .meta i { flex-shrink:0; }
      .cap span[lang] { font:inherit; margin:0; letter-spacing:normal; }
      @media(min-aspect-ratio:6/5) { .head, .foot { text-align:start; } }
    `;
  }
  if (id === "pressed-compact") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const words = (copy["Touch-up sale"] || "Touch-up sale").split(/\s+/);
    const longest = Math.max(...words.map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    const discountFirst = ["id", "ms", "vi", "th", "zh", "zh-Hant", "sw", "zu"].includes(lang);
    return `
      .banner { --d:32vmin; }
      .panel { container-type:inline-size; gap:1.8vmin; }
      .panel > div { max-width:100%; }
      .kick { letter-spacing:.06em; margin-right:0; }
      h1 { font-size:min(5.5vmin,${(150 / longest).toFixed(2)}cqw); white-space:normal; line-height:1.15; overflow-wrap:anywhere; }
      .pan span[lang] { display:inline; font:inherit; margin:0; color:inherit; letter-spacing:normal; }
      .pan > span { max-width:85%; letter-spacing:.04em; margin-right:0; line-height:1.15; ${discountFirst ? "order:-1; margin-block:0 1vmin;" : ""} }
      .foot { white-space:normal; letter-spacing:.04em; font-size:1.9vmin; line-height:1.25; }
      .foot b { display:inline-block; margin-top:1vmin; letter-spacing:.08em; }
      @media(min-aspect-ratio:9/10) { .banner { --d:24vmin; } }
      @media(min-aspect-ratio:6/5) { .banner { --d:38vmin; } }
    `;
  }
  if (id === "vertical-cover") {
    const text = copy.Essentials || "Essentials";
    const count = Math.max([...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(text)].length, [...text].length * .7);
    const verticalScript = ["ja", "ko", "zh", "zh-Hant"].includes(lang);
    const titleSpan = verticalScript ? 60 : lang === "kn" ? 65 : ["am", "ml", "mr", "ta", "te"].includes(lang) ? 78 : 100;
    return `
      .word { writing-mode:${verticalScript ? "vertical-rl" : "horizontal-tb"}; transform:translate(-50%,-50%)${verticalScript ? "" : " rotate(-90deg)"}; direction:${verticalScript ? "ltr" : "inherit"}; font-size:min(22vmin,${(titleSpan / count).toFixed(2)}vh); line-height:1.15; letter-spacing:0; }
      .tl, .bl { padding-inline:1.4vmin; overflow-wrap:anywhere; letter-spacing:.04em; }
      .tl span[lang] { display:inline; font:inherit; }
      .bl b { font-size:2.6vmin; }
      .tag { max-width:65%; box-sizing:border-box; letter-spacing:.06em; }
      .tag i { flex-shrink:0; }
      html[dir="rtl"] .spine { left:auto; right:0; }
      html[dir="rtl"] .photo { right:auto; left:0; }
      html[dir="rtl"] .tag { right:auto; left:0; }
    `;
  }
  if (id === "festive-lights") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const words = (copy["The Festive Edit"] || "The Festive Edit").split(/\s+/);
    const longest = Math.max(...words.map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .copy { container-type:inline-size; }
      h1 { font-size:min(8vmin,${(140 / longest).toFixed(2)}cqw); max-width:100%; overflow-wrap:anywhere; line-height:1.12; }
      .k { max-width:100%; letter-spacing:.08em; margin-right:0; }
      .p { max-width:100%; }
      .offer { max-width:100%; flex-wrap:wrap; justify-content:center; letter-spacing:.06em; }
      .offer > span { min-width:0; max-width:100%; overflow-wrap:anywhere; }
      .offer i { flex-shrink:0; }
      .cta { max-width:100%; box-sizing:border-box; letter-spacing:.08em; }
    `;
  }
  if (id === "plinth-column") return `
    .text { align-items:flex-start; }
    .t { min-width:0; overflow-wrap:anywhere; }
    .t span[lang] { display:inline; font:inherit; color:inherit; margin:0; letter-spacing:normal; }
    .cta { flex-shrink:0; max-width:35%; white-space:normal; letter-spacing:.08em; }
    .fig { right:5vmin; letter-spacing:.08em; }
    @media(min-aspect-ratio:9/10) { .cta { max-width:100%; } }
  `;
  if (id === "correspondence-card") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const words = (copy["With compliments,"] || "With compliments,").split(/\s+/);
    const longest = Math.max(...words.map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .card { container-type:inline-size; }
      .mono { direction:ltr; unicode-bidi:isolate; }
      .addr { max-width:100%; letter-spacing:.08em; margin-right:0; }
      .script { font-size:min(5.5vmin,${(145 / longest).toFixed(2)}cqw); max-width:100%; overflow-wrap:anywhere; line-height:1.2; }
      .body { max-width:100%; font-size:2.6vmin; line-height:1.3; }
      .code { max-width:100%; white-space:normal; flex-wrap:wrap; justify-content:center; letter-spacing:.06em; }
      .code b { white-space:nowrap; }
      @media(min-aspect-ratio:9/10) and (max-aspect-ratio:6/5) { .body { font-size:2.3vmin; } }
    `;
  }
  if (id === "quiet") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const words = `${copy["The Embroidered"] || "The Embroidered"} ${copy.Edit || "Edit"}`.split(/\s+/);
    const longest = Math.max(...words.map(word => Math.max([...segmenter.segment(word)].length, [...word].length * .7)));
    return `
      .copy { container-type:inline-size; min-width:0; }
      h1 { font-size:min(7vmin,${(150 / longest).toFixed(2)}cqw); line-height:1.15; max-width:100%; overflow-wrap:anywhere; }
      .k { letter-spacing:.08em; margin-right:0; max-width:100%; }
      .d { font-size:2.6vmin; line-height:1.35; max-width:100%; }
      .cta { max-width:100%; font-size:2.6vmin; letter-spacing:.08em; }
      .cta i { flex-shrink:0; }
    `;
  }
  if (id === "contents-page") {
    const segmenter = new Intl.Segmenter(lang, { granularity:"grapheme" });
    const heading = copy.Contents || "Contents";
    const length = Math.max([...segmenter.segment(heading)].length / 1.8, ...heading.split(/\s+/).map(word => [...segmenter.segment(word)].length));
    return `
      .head { container-type:inline-size; align-items:flex-start; }
      .head h1 { font-size:min(7.4vmin,${(85 / length).toFixed(2)}cqw); line-height:1.15; max-width:100%; overflow-wrap:anywhere; }
      html[dir="rtl"] .head h1 bdi { font-size:1em; }
      .head .meta { letter-spacing:.04em; flex-shrink:0; text-align:end; }
      .e { column-gap:1vmin; grid-template-columns:10vmin minmax(0,1fr); }
      .e .n { font-size:5vmin; }
      .e .t { letter-spacing:.02em; line-height:1.2; }
      .e .d { line-height:1.2; font-style:normal; }
      .e.hot .t > span[lang] { display:inline; margin:0; padding:0; color:inherit; background:none; letter-spacing:normal; }
      .foot { letter-spacing:.04em; gap:2vmin; }
      .foot .cta { min-width:0; }
      .foot .cta i { flex-shrink:0; }
      @media(min-aspect-ratio:9/10) {
        .head { gap:1vmin; }
        .head h1 { font-size:min(6vmin,${(70 / length).toFixed(2)}cqw); }
        .head .meta { text-align:start; line-height:1.25; }
      }
      @media(min-aspect-ratio:6/5) {
        .head h1 { max-width:58%; font-size:min(7.4vmin,${(50 / length).toFixed(2)}cqw); }
        .head .meta { max-width:40%; flex-shrink:1; text-align:end; }
      }
    `;
  }
  if (id === "pull-quote") {
    const length = [...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(`${copy["Make fewer things."] || "Make fewer things."} ${copy["Make them last."] || "Make them last."}`)].length;
    const scale = Math.min(1, Math.sqrt(30 / length));
    return `
      .quote { font-size:${(8 * scale).toFixed(2)}vmin; line-height:1.15; overflow-wrap:anywhere; }
      .row { letter-spacing:.05em; gap:1vmin; }
      .row > span > span[lang] { display:inline; font:inherit; }
      .by { right:auto; width:54%; max-width:54%; }
      .by b { letter-spacing:.04em; }
      .by span[lang] { display:inline; margin:0; font:inherit; color:inherit; }
      .cta { max-width:29%; letter-spacing:.04em; text-align:end; }
      .qa b { letter-spacing:.04em; }
      @media(min-aspect-ratio:7/10) {
        .quote { font-size:${(7.3 * scale).toFixed(2)}vmin; }
      }
      @media(min-aspect-ratio:9/10) {
        .quote { font-size:${(6.4 * scale).toFixed(2)}vmin; }
        .by { width:44%; max-width:44%; }
        .cta { max-width:44%; text-align:start; }
      }
      @media(min-aspect-ratio:6/5) {
        .quote { font-size:${(7.8 * scale).toFixed(2)}vmin; }
        .by { width:28%; max-width:28%; }
        .cta { max-width:23%; text-align:end; }
      }
    `;
  }
  if (id === "ma-vertical" && (copy["間"] || "").length > 2) return ".seal { font-size:1.1vmin; letter-spacing:0; font-family:Arial,sans-serif; }";
  if (id === "wabi-seal") {
    const count = Math.max(...["新", "作"].map(key => [...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(copy[key] || key)].length));
    return `.seal text { font-size:${Math.min(27, 95 / count).toFixed(2)}px; letter-spacing:0; } .copy .k { white-space:normal; }`;
  }
  if (id === "type-specimen") return `
    .wf { container-type:inline-size; }
    .l { gap:1vmin; }
    .l b { min-width:0; }
    .l1 b { font-size:min(7vmin,14cqw); }
    .l2 b { font-size:min(3.4vmin,6.5cqw); }
    .l3 b { font-size:min(2.3vmin,4.5cqw); }
    .l4 b { white-space:normal; font-size:1.5vmin; overflow-wrap:anywhere; }
  `;
  if (id === "drop-countdown") return `
    h1 { font-size:5.8vmin; line-height:1.08; overflow-wrap:normal; }
    .tile small { letter-spacing:0; }
    .foot { gap:1.6vmin; }
    .cta { white-space:normal; }
  `;
  if (id === "mail-order") {
    const count = [...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(copy["Sunday Best"] || "Sunday Best")].length;
    return `h1 { font-size:${Math.min(12, 145 / count).toFixed(2)}vmin; } .cta { box-sizing:border-box; max-width:100%; white-space:normal; letter-spacing:.08em; }`;
  }
  if (id === "mood-board") {
    const count = [...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(copy.Mood || "Mood")].length;
    return `h1 { font-size:${Math.min(13, 72 / count).toFixed(2)}vmin; line-height:1.05; } .words { max-width:49%; } .w2 { font-size:4.4vmin; line-height:1.1; margin-inline:0; }`;
  }
  if (id === "receipt-print") return `
    .line .n { flex:1; min-width:0; }
    .line .dots { flex:0 0 2vmin; }
    .line .p { white-space:nowrap; }
    .line { font-size:2.6vmin; line-height:1.15; }
    .stamp small { text-align:center; font-size:1.7vmin; letter-spacing:0; line-height:1.15; }
  `;
  if (lang === "en") return "";
  if (id === "price-odometer") {
    // The drums form one number even when surrounding copy reads right to left.
    const parts = new Intl.NumberFormat(lang, { style: "currency", currency: "USD" }).formatToParts(149);
    const currencyAfter = parts.findIndex(part => part.type === "currency") > parts.findIndex(part => part.type === "integer");
    return `
      .drums { direction:ltr; unicode-bidi:isolate; }
      .cur { order:${currencyAfter ? 1 : -1}; width:auto; min-width:calc(var(--dw) * .8); padding-inline:.7vmin; font-size:calc(var(--dh) * .24); }
      .meter { min-width:0; }
      .foot .cta { white-space:normal; }
    `;
  }
  if (id === "carat-scale") return `
    .lcd { container-type:inline-size; min-width:0; grid-template-columns:minmax(0,1fr); }
    .read { min-width:0; font-size:min(12vmin,27cqw); line-height:1.2; }
    .unit { grid-column:1; }
    h1 { line-height:1.2; }
    .keys { flex-wrap:wrap; }
    .keys .go { white-space:normal; }
  `;
  if (id === "size-guide") return `
    .head { min-width:0; container-type:inline-size; }
    h1 { white-space:normal; font-size:min(7.4vmin,21cqw); line-height:1.15; }
    .model { text-align:start; }
    .cta { white-space:normal; min-height:6.4vmin; height:auto; padding-block:1.2vmin; gap:1vmin; }
  `;
  if (id === "flash") {
    const count = [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(copy.OFF || "OFF")].length;
    const hours = [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(copy["48H"] || "48H")].length;
    return `
      .big .off { font-size:${Math.min(15, 52 / count).toFixed(2)}vmin; line-height:1.05; white-space:nowrap; letter-spacing:0; -webkit-text-stroke:.18vmin #111; }
      .big .off bdi { font-size:1em !important; }
      .badge .h { font-size:${Math.min(5.8, 21 / hours).toFixed(2)}vmin; letter-spacing:0; white-space:normal; max-width:85%; margin-inline:auto; line-height:1.1; }
      .badge .h bdi { font-size:1em !important; }
      .copy .cta { max-width:100%; box-sizing:border-box; white-space:normal; letter-spacing:.05em; font-size:2.5vmin; padding:2vmin 3vmin; }
      html[dir="rtl"] .photo { left:0; right:auto; }
      html[dir="rtl"] .fade { left:auto; right:44%; transform:scaleX(-1); }
      html[dir="rtl"] .copy { left:auto; right:6vmin; }
      html[dir="rtl"] .badge { left:auto; right:calc(44% - 8vmin); }
      @media(min-aspect-ratio:17/20) { html[dir="rtl"] .badge { right:calc(44% - 2vmin); } }
      @media(min-aspect-ratio:6/5) { html[dir="rtl"] .fade { right:40%; } html[dir="rtl"] .badge { right:calc(40% - 2vmin); } }
    `;
  }
  if (id === "black-tie") {
    const one = Math.min(1, 5 / [...(copy.Black || "Black")].length);
    const two = Math.min(1, 4 / [...(copy["Tie."] || "Tie.")].length);
    return `
      .w1 { font-size:calc(24vmin * ${one.toFixed(3)}); }
      .w2 { font-size:calc(24vmin * ${two.toFixed(3)}); }
      @media(max-aspect-ratio:9/10) {
        .w1 { top:12vmin; font-size:min(16vmin, calc(24vmin * ${one.toFixed(3)})); }
        .m1 { top:3vmin; max-width:90%; white-space:normal; }
      }
      html[dir="rtl"] .w { left:5vmin; right:5vmin; transform:none; font-size:12vmin; line-height:1.15; font-style:normal; white-space:normal; text-align:right; }
      html[dir="rtl"] .w1 { top:10vmin; }
      html[dir="rtl"] .w2 { top:auto; bottom:12vmin; }
      html[dir="rtl"] .photo { left:0; right:0; top:30vmin; width:100%; height:calc(100% - 65vmin); }
      html[dir="rtl"] .m1 { left:auto; right:5vmin; top:3vmin; transform:none; text-align:right; }
      html[dir="rtl"] .m2 { left:5vmin; right:5vmin; bottom:3vmin; transform:none; text-align:right; }
    `;
  }
  if (id === "show-schedule") {
    const seasonLength = [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(copy.AW26 || "AW26")].length;
    const size = Math.min(9.5, 75 / (seasonLength * (["ja", "ko", "zh", "zh-Hant"].includes(lang) ? 1.6 : 1))).toFixed(2);
    const titleWords = `${copy.Show || "Show"} ${copy.Schedule || "Schedule"}`.split(/\s+/);
    const longest = Math.max(...titleWords.map(word => Math.max([...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(word)].length, [...word].length * .7)));
    const eventLength = Math.max(...["Early access", "Online launch", "Store opening", "Last call"].map(key => [...new Intl.Segmenter(lang, { granularity:"grapheme" }).segment(copy[key] || key)].length));
    const eventScale = Math.min(1, Math.sqrt(12 / eventLength));
    return `
      .head { container-type:inline-size; gap:2vmin; }
      .season { font-size:${size}vmin; line-height:1.1; max-width:48%; overflow-wrap:anywhere; }
      .season sup { font-size:1.8vmin; }
      .title { font-size:min(4.4vmin,${(75 / longest).toFixed(2)}cqw); max-width:48%; line-height:1.15; overflow-wrap:anywhere; }
      .title small { letter-spacing:0; font-size:1.6vmin; }
      .sub { gap:2vmin; letter-spacing:.02em; }
      .r { grid-template-columns:minmax(0,1.25fr) minmax(0,.8fr) minmax(0,1.9fr) minmax(0,1.25fr); }
      .r > span { min-width:0; overflow-wrap:anywhere; line-height:1.25; }
      .r .d, .r .h, .r .w { letter-spacing:0; }
      .r .e { font-size:${(3.3 * eventScale).toFixed(2)}vmin; white-space:normal; min-width:0; line-height:1.2; }
      .head > * { min-width:0; }
      @media(min-aspect-ratio:9/10) and (max-aspect-ratio:6/5) {
        .head { gap:1.2vmin; }
        .season { max-width:100%; }
        .title { max-width:100%; font-size:min(4vmin,${(135 / longest).toFixed(2)}cqw); }
        .r { grid-template-columns:minmax(0,1.1fr) minmax(0,.8fr) minmax(0,2fr); }
        .r .e { font-size:${(2.8 * eventScale).toFixed(2)}vmin; }
      }
    `;
  }
  if (id === "defile-invitation") {
    const count = [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(copy["Défilé"] || "Défilé")].length;
    return `
      .main { container-type:inline-size; }
      .h { font-size:${Math.min(9, 70 / count).toFixed(2)}vmin; line-height:1.05; }
      @supports(font-size:1cqw) { .h { font-size:min(9vmin, calc(120cqw / ${count})); } }
      .req { font-size:3.4vmin; line-height:1.15; }
      .season { letter-spacing:.05em; margin-right:0; white-space:normal; }
      .rsvp { letter-spacing:.05em; margin-right:0; }
      .when .nw { white-space:normal; }
    `;
  }
  if (id === "first-look") {
    const lengths = ["The First", "Collection"].map(key => [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(copy[key] || key)].length);
    return `
      .copy { container-type:inline-size; }
      .h { font-size:${Math.min(11, 70 / Math.max(...lengths)).toFixed(2)}vmin; line-height:1; }
      @supports(font-size:1cqw) { .h { font-size:min(11vmin, calc(120cqw / ${Math.max(...lengths)})); } }
      .row { flex-wrap:wrap; }
      .by, .cta { min-width:0; max-width:100%; overflow-wrap:anywhere; }
    `;
  }
  if (id === "swiss") {
    const longest = Math.max(...["New", "sea—", "son."].map(key => [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(copy[key] || key)].length));
    return `
    h1 { font-size:${Math.min(11.4, 42 / longest).toFixed(2)}vmin; line-height:1; }
    .foot { flex-direction:column; align-items:stretch; gap:2.5vmin; }
    .season { display:flex; align-items:center; gap:2vmin; font-size:9vmin; line-height:1; }
    .season sup { font-size:2.6vmin; line-height:1.2; letter-spacing:0; vertical-align:baseline; }
    .cta { white-space:normal; align-self:flex-start; }
    html[dir="rtl"] .photo { right:auto; left:0; }
    html[dir="rtl"] .col { left:auto; right:5.5vmin; }
    html[dir="rtl"] .tag { right:auto; left:3.4vmin; }
  `;
  }
  if (id === "raffle-drop") {
    const words = `${copy["Enter the"] || "Enter the"} ${copy.draw || "draw"}`.split(/\s+/);
    const longest = Math.max(...words.map(word => [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(word)].length));
    return `
    .go { min-height:8.4vmin; flex-shrink:0; }
    .clock small { letter-spacing:0; }
    @media(min-aspect-ratio:7/10) and (max-aspect-ratio:6/5) {
      h1 { font-size:${Math.min(8.4, 55 / longest).toFixed(2)}vmin; line-height:1.05; }
    }
  `;
  }
  return "";
}
module.exports = { localizedLayout };
