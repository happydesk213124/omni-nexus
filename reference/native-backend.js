/* Inlay Nexus Backend — no Python/local HTTP server. Self-contained IIFE.
 * HARD RULE: never add a localhost bridge, :28120 server, or any companion backend.
 * Storage: risuai.getLocalPluginStorage() = IndexedDB (localforage) · JSON · device-local.
 * Do NOT use safeLocalStorage (localStorage · strings only) for PNG/settings.
 * Images: IndexedDB bytes (WebP@0.8 when possible, else PNG) as base64 + data:image URLs for display.
 */
(function () {
  "use strict";

  const VERSION = "1.3.0";
  const PROMPT_PACK = "2026-08-02-lore-extra-boundary";
  const FORCE_PROMPT_KEYS = ["tagger", "format", "appearance_inject", "lore_inject", "autotag"];
  const PROMPT_KEYS = ["author_note", "tagger", "format", "prefill", "preprocess", "preset_1", "lore_inject", "char_inject", "appearance_inject", "autotag"];
  const GLOBAL_SCOPE = "__global__";
  const PLUGIN_NAME = "inlay-nexus-native";
  // Device-local IndexedDB keys (shared namespace → prefix with plugin id).
  const SETTINGS_KEY = "inx_native_settings";
  const STORE_KEY = (name) => `inx_nxstore_${name}`;
  const IMAGE_KEY = (id) => `inx_nximg_${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const REF_IMAGE_KEY = "inx_nxref_image";
  const VIBE_IMAGE_KEY = "inx_nxvibe_image";
  const VIBE_DATA_KEY = "inx_nxvibe_data";
  // Legacy save-file pluginStorage keys (one-time migrate → IndexedDB).
  const LEGACY_SETTINGS_KEY = "native_settings";
  const LEGACY_STORE_KEY = (name) => `nxstore_${name}`;
  const LEGACY_IMAGE_KEY = (id) => `nximg_${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const LEGACY_REF_IMAGE_KEY = "nxref_image";
  const API_URL = "https://image.novelai.net/ai/generate-image";
  const ENCODE_URL = "https://image.novelai.net/ai/encode-vibe";
  const ANLAS_URL = "https://api.novelai.net/user/subscription";
  const STORE_NAMES = ["meta", "cards", "characters", "jobs", "images"];
  const DEBUG_MAX = 240;
  const debugEvents = [];
  let debugJobCtx = "";
  let debugLastError = null;
  let debugLastStage = "boot";
  /** Job heartbeat should show this, not noisy background storage stages. */
  let debugFocusStage = "boot";
  let imagePersistChain = Promise.resolve();
  /** While true, skip IndexedDB flushes so NAI body RPC is not contended. */
  let pauseDiskPersist = false;
  let naiBodyBytesReceived = 0;
  let naiBodyBytesExpected = 0;
  let naiLastByteAt = 0;
  /** Active body-read controller — heartbeat can force-finish when ZIP bytes are already in. */
  let naiBodyControl = null;

  function zipHasEocd(u8) {
    if (!u8 || u8.length < 22) return false;
    const start = Math.max(0, u8.length - 65536);
    for (let i = u8.length - 22; i >= start; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
        const commentLen = u8[i + 20] | (u8[i + 21] << 8);
        // Full EOCD record must be present (avoid false positives in compressed payload).
        if (i + 22 + commentLen <= u8.length) return true;
      }
    }
    return false;
  }

  function concatChunks(chunks, total) {
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  function dbgClip(v, max = 280) {
    if (v == null) return v;
    if (typeof v === "number" || typeof v === "boolean") return v;
    const s = typeof v === "string" ? v : (() => {
      try {
        return JSON.stringify(v);
      } catch (_) {
        return String(v);
      }
    })();
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…(+${s.length - max})`;
  }

  function dbg(stage, detail = {}, level = "info") {
    const entry = {
      t: Date.now(),
      iso: new Date().toISOString(),
      stage: String(stage || ""),
      level,
      job_id: debugJobCtx || detail.job_id || "",
      ms: detail.ms != null ? Number(detail.ms) : undefined,
      bytes: detail.bytes != null ? Number(detail.bytes) : undefined,
      status: detail.status != null ? detail.status : undefined,
      message: detail.message != null ? dbgClip(detail.message, 240) : undefined,
      detail: {},
    };
    for (const [k, v] of Object.entries(detail || {})) {
      if (["ms", "bytes", "status", "message", "job_id", "background", "focus"].includes(k)) continue;
      if (v == null || typeof v === "number" || typeof v === "boolean") entry.detail[k] = v;
      else entry.detail[k] = dbgClip(v, 220);
    }
    debugEvents.push(entry);
    while (debugEvents.length > DEBUG_MAX) debugEvents.shift();
    debugLastStage = entry.stage;
    if (detail.focus || (!detail.background && (entry.stage.startsWith("job.") || entry.stage.startsWith("nai.") || entry.stage.startsWith("llm.") || entry.stage.startsWith("image.")))) {
      debugFocusStage = entry.stage;
    }
    if (level === "error") debugLastError = { stage: entry.stage, message: entry.message || "", t: entry.t };
    const line = `[InlayNX:${entry.stage}]${entry.message ? ` ${entry.message}` : ""}${entry.ms != null ? ` ${entry.ms}ms` : ""}${entry.bytes != null ? ` ${entry.bytes}B` : ""}`;
    if (level === "error") console.error(line, entry.detail);
    else if (level === "warn") console.warn(line, entry.detail);
    else console.log(line, entry.detail);
    return entry;
  }

  function dbgSpan(stage) {
    const t0 = Date.now();
    return {
      end(detail = {}, level = "info") {
        return dbg(stage, { ...detail, ms: Date.now() - t0 }, level);
      },
      fail(err, detail = {}) {
        return dbg(stage, { ...detail, message: String(err?.message || err), ms: Date.now() - t0 }, "error");
      },
    };
  }

  function debugSnapshot() {
    const g = globalThis.risuai || {};
    let hidden = null;
    try {
      hidden = typeof document !== "undefined" ? Boolean(document.hidden) : null;
    } catch (_) {}
    const recent = debugEvents.slice(-80);
    const errors = debugEvents.filter((e) => e.level === "error").slice(-20);
    const byStage = {};
    for (const e of recent) byStage[e.stage] = (byStage[e.stage] || 0) + 1;
    return {
      ok: true,
      version: VERSION,
      now: Date.now(),
      last_stage: debugLastStage,
      focus_stage: debugFocusStage,
      last_error: debugLastError,
      job_ctx: debugJobCtx || null,
      env: {
        has_nativeFetch: typeof g.nativeFetch === "function",
        has_getLocalPluginStorage: typeof g.getLocalPluginStorage === "function",
        has_pluginStorage: Boolean(g.pluginStorage?.getItem),
        has_DecompressionStream: typeof DecompressionStream === "function",
        has_AbortController: typeof AbortController !== "undefined",
        document_hidden: hidden,
      },
      counts: {
        events: debugEvents.length,
        cards: memStores?.cards?.size ?? 0,
        images: memStores?.images?.size ?? 0,
        jobs: memStores?.jobs?.size ?? 0,
        blob_urls: blobUrlCache?.size ?? 0,
      },
      by_stage: byStage,
      errors,
      events: recent,
    };
  }

  const DEFAULT_CONFIG = {
    bind_host: "",
    port: 0,
    auth_token: "",
    allowed_origins: [],
    // Legacy Python fields kept for UI compat — mapped to device-local IndexedDB.
    database_path: "indexeddb:getLocalPluginStorage",
    images_dir: "indexeddb:inx_nximg_*",
    prompts_dir: "embedded",
    storage: {
      backend: "indexeddb",
      api: "getLocalPluginStorage",
      image_encoding: "base64",
      scope: "device-local",
      notes: "PNG/settings live on this device (not save-file). Folder explorer reads card+location metadata.",
    },
    card: {
      power: true,
      execute: "auto",
      mode: "illustration",
      image_min: 3,
      image_max: 3,
      character_max: 2,
      preset: 1,
      lorebook: true,
      lore_extra: "tags",
      char_info: true,
      user_info: true,
      char_appearance: true,
      preprocessing: false,
      person_tag_mode: "gender",
      auto_person_tags: true,
      original_text: "",
      custom_pos: "1.5::artist:sasamori tomoe, artist:sohn woohyoung::, 0.9::artist:hero_neisan, artist:takano suzu::, 0.4::artist:kidmo::, 1.3::seoyong::, 1.2::healthyman::, freng, 1.1::murata yuusuke::, 1.2::hiramedousa::, 1.2::artist:sos adult::, 1.7::shinjiro, artist:umezawa_itte::, -3::artist collaboration::, year 2025, year 2024, realstic 3d, -3::spoken bubble, text, cross-section::, rating:explicit, -3::multiple views::, -3::small lines::, 1.5::balanced contrast::, -2::simple illustration::, -1::censored::, best quality, amazing quality, very aesthetic, highres, incredibly absurdres,",
      custom_neg: "blank page, logo, watermark, too many watermarks, reference, signature, artist name, dated, artistic error, scan artifacts, jpeg artifacts, upscaled, aliasing, film grain, heavy film grain, dithering, chromatic aberration, digital dissolve, artist:xinzoruo, one-hour drawing challenge, toon (style), 1990s (style), 4koma, 2koma, mutation, deformed, distorted, disfigured, bad anatomy, unnatural hair, bad face, mob face, bad eyes, empty eyes, bad proportions, bad limbs, amputee, bad arm, bad hands, bad hand structure, six fingers extra digits, fewer digits, bad leg, extra leg, distorted composition, bad perspective, disorganized colors, unfinished, incomplete, displeasing, very displeasing, unsatisfactory, inadequate, deficient, subpar, poor, blurry, lowres, worst quality, bad quality, fewer details, bad portrait, bad illustration, 2::dark pussy, pink pussy, red pussy::, 2::pale skin, red skin, yellow skin, blush::, shark teeth",
      presets: [
        {
          "id": "프리셋_닭장_0_14izz",
          "name": "프리셋 1",
          "positive": "1.5::artist:sasamori tomoe, artist:sohn woohyoung::, 0.9::artist:hero_neisan, artist:takano suzu::, 0.4::artist:kidmo::, 1.3::seoyong::, 1.2::healthyman::, freng, 1.1::murata yuusuke::, 1.2::hiramedousa::, 1.2::artist:sos adult::, 1.7::shinjiro, artist:umezawa_itte::, -3::artist collaboration::, year 2025, year 2024, realstic 3d, -3::spoken bubble, text, cross-section::, rating:explicit, -3::multiple views::, -3::small lines::, 1.5::balanced contrast::, -2::simple illustration::, -1::censored::, best quality, amazing quality, very aesthetic, highres, incredibly absurdres,",
          "negative": "blank page, logo, watermark, too many watermarks, reference, signature, artist name, dated, artistic error, scan artifacts, jpeg artifacts, upscaled, aliasing, film grain, heavy film grain, dithering, chromatic aberration, digital dissolve, artist:xinzoruo, one-hour drawing challenge, toon (style), 1990s (style), 4koma, 2koma, mutation, deformed, distorted, disfigured, bad anatomy, unnatural hair, bad face, mob face, bad eyes, empty eyes, bad proportions, bad limbs, amputee, bad arm, bad hands, bad hand structure, six fingers extra digits, fewer digits, bad leg, extra leg, distorted composition, bad perspective, disorganized colors, unfinished, incomplete, displeasing, very displeasing, unsatisfactory, inadequate, deficient, subpar, poor, blurry, lowres, worst quality, bad quality, fewer details, bad portrait, bad illustration, 2::dark pussy, pink pussy, red pussy::, 2::pale skin, red skin, yellow skin, blush::, shark teeth"
        },
        {
          "id": "프리셋_농후_1_u4veg",
          "name": "프리셋 2",
          "positive": "2.0::artist:duoyuanjun::, artist:dawalixi, artist:m (1n910), 1.45::artist:murata yuusuke::, 1.4::artist:konya karasue::, 1.5::artist:wanke::, 2.3::artist:lunch(shin new)::, 0.8::artist:baffu::, 1.4::artist:ishigaki takashi::, 0.8::artist:xipa::, 0.8::artist:freng::, 0.5::artist:kim eb::, year 2025, year 2024, 0.5::3d, blender::, high detail, masterpiece, best quality, very aesthetic, highres, best illustration, novel illustration, -3::simple illustration::, -1::censored::, -3::artist collaboration::, detailed background, -1::door::",
          "negative": "blank page, text, logo, watermark, too many watermarks, reference, signature, artist name, dated, artistic error, scan artifacts, jpeg artifacts, upscaled, aliasing, film grain, heavy film grain, dithering, chromatic aberration, digital dissolve, halftone, screentones, artist:xinzoruo, artist:milkpanda, artist:kurukurumagical, artist collaboration, one-hour drawing challenge, toon (style), 1990s (style), 4koma, 2koma, mutation, deformed, distorted, disfigured, bad anatomy, unnatural hair, bad face, mob face, bad eyes, empty eyes, bad proportions, bad limbs, amputee, bad arm, bad hands, bad hand structure, extra digits, fewer digits, bad leg, extra leg, distorted composition, bad perspective, multiple views, disorganized colors, unfinished, incomplete, displeasing, very displeasing, unsatisfactory, inadequate, deficient, subpar, poor, blurry, lowres, worst quality, bad quality, fewer details, bad portrait, bad illustration"
        },
        {
          "id": "프리셋_매끈_2_jgrz3",
          "name": "프리셋 3",
          "positive": "2.4::artist:uki_(ukikusaya) ::, 0.6::artist:sohn woohyoung::, 0.6::artist:minamoto (mutton) ::, artist:sakura no tomoru hi e, 0.5::artist:bettkan::, 0.4::artist:nanja::, 0.4::artist:joy boy \\(jerrydurd\\) ::, artist:freng, 0.2::artist:murata yuusuke::, 0.8::artist:mx2j::, artist:aoi nagisa (metalder), 0.2::artist:oda non::, 0.4::artist:lunch_(shin new) ::, 0.6::artist:duoyuanjun::, year 2025, year 2024, year 2023, solo artist, -5.3::artist collaboration::, -1::faux retro artstyle::, -1::film grain::, -1::clean text::, -1::flat color::, 1.2::3d::, blender(medium), 1.3::realistic::, natural, incredibly absurdres, very aesthetic, highres, masterpiece, best quality, amazing quality, -3::simple illustration::, best illustration, novel illustration, 0.06::best::, -1::ring::, 1.5::uncensored::, -2::censored::, -2::bar censor::, 2::shiny realistic skin::, 1.3::steaming body::,",
          "negative": "blank page, text, logo, watermark, too many watermarks, reference, signature, artist name, dated, artistic error, scan artifacts, jpeg artifacts, upscaled, aliasing, film grain, heavy film grain, dithering, chromatic aberration, digital dissolve, halftone, screentones, artist:xinzoruo, artist:milkpanda, artist:kurukurumagical, artist collaboration, one-hour drawing challenge, toon (style), 1990s (style), 4koma, 2koma, character sheet, reference sheet, lineup, mutation, deformed, distorted, disfigured, bad anatomy, unnatural hair, bad face, mob face, bad eyes, empty eyes, bad proportions, bad limbs, amputee, bad arm, bad hands, bad hand structure, extra digits, fewer digits, bad leg, extra leg, distorted composition, bad perspective, multiple views, disorganized colors, unfinished, incomplete, displeasing, very displeasing, unsatisfactory, inadequate, deficient, subpar, poor, blurry, lowres, worst quality, bad quality, fewer details, bad portrait, bad illustration,"
        },
        {
          "id": "프리셋_닭_3_8yiw2",
          "name": "프리셋 2-1",
          "positive": "1.5::artist:sohn woohyoung::, 1.6::artist:solipsist::, 1.45::artist:gogalking::, 1.2::artist:oda non::, 1.25::artist:henriiku_(ahemaru) ::, 1.6::artist:Ask (Askzy) ::, 2.7::artist:jagercoke::, 2::artist:seven (sixplusone) ::, artist:wlop, 1.25::artist:wanke::, artist:seoyong, 0.7::artist:healthyman::, artist:freng, 1.2::artist:sos adult::, artist:shinjiro, 2::artist:nianbingzi::, artist:teshima nari, year 2024, year 2025, 2::blender (medium) ::, 2::pastel (medium) ::, -2::flat color::, pastel colors, 1.4::masterpiece, very aesthetic::, best quality, amazing quality, absurdres, 2::realistic::, -6::artist collaboration::, -3::multiple view, people, crowd, 2koma, x-ray, internal cumshot::, no text, -1.1::pubic hair::, uncensored,",
          "negative": "natsuki karin, text, logo, watermark, too many watermarks, blank page, text-only page, reference, username, signature, artist:xinzoruo, artist:milkpanda, artist collaboration, variant set, large variant set, 4koma, 2koma, toon (style), chibi, turnaround, film grain, monochrome, dithering, halftone, screentones, dated, old, 1990s (style), mutation, deformed, distorted, disfigured, artistic error, distorted anatomy, anatomical structure error, asymmetrical face, unnatural hair, bad eyes, cloudy eyes, blank eyes, bad proportions, bad limb, extra digits, fewer digits, bad legs, extra legs, amputee, distorted composition, bad perspective, multiple views, negative space, animation error, chromatic aberration, disorganized colors, scan artifacts, jpeg artifacts, vertical lines, vertical banding, worst quality, bad quality, lowres, blurry, upscaled, fewer details, unfinished, incomplete, amateur, cheesy, unsatisfactory, inadequate, deficient, subpar, poor, displeasing, very displeasing, bad illustration, bad portrait, sketch"
        },
        {
          "id": "프리셋_말랑_4_ian7o",
          "name": "프리셋 말랑",
          "positive": "artist:freng, 1.2::artist:taesi::, artist:sohn woohyoung, 0.7::artist:oda non::, 1.5::artist:aoi nagisa (metalder) ::, 0.5::artist:chamchami::, 0.5::artist:blue gk::, artist:modare, artist:dishwasher1910, year 2025, year:2024, best quality, amazing quality, very aesthetic, highres, incredibly absurdres, high detail, masterpiece, -3::simple illustration::, novel illustration, best illustration, -1::multiple views::, no text, -3::multiple view, people, crowd, 2koma, x-ray, internal cumshot::, 2::nsfw::,",
          "negative": "text, logo, cartoon, flat color, spot color, watermark, too many watermarks, blank page, text-only page, reference, username, signature, artist:xinzoruo, artist:milkpanda, artist collaboration, variant set, large variant set, 4koma, 2koma, toon (style), oekaki, chibi, turnaround, film grain, monochrome, dithering, halftone, screentones, dated, old, 1990s (style), mutation, deformed, distorted, disfigured, artistic error, distorted anatomy, anatomical structure error, asymmetrical face, unnatural hair, bad eyes, cloudy eyes, blank eyes, bad proportions, bad limb, bad hands, extra hands, bad hand structure, extra digits, fewer digits, bad legs, extra legs, amputee, distorted composition, bad perspective, multiple views, negative space, animation error, chromatic aberration, disorganized colors, scan artifacts, jpeg artifacts, vertical lines, vertical banding, worst quality, bad quality, lowres, blurry, upscaled, fewer details, unfinished, incomplete, amateur, cheesy, unsatisfactory, inadequate, deficient, subpar, poor, displeasing, very displeasing, bad illustration, bad portrait, limited palette, six finger, four finger, three finger, bad anatomy,"
        },
        {
          "id": "프리셋_깔_5_3rh46",
          "name": "프리셋 깔",
          "positive": "artist:freng, 1.2::artist:taesi::, artist:sohn woohyoung, 0.7::artist:oda non::, 1.5::artist:aoi nagisa (metalder) ::, 0.5::artist:chamchami::, 0.5::artist:blue gk::, artist:modare, artist:dishwasher1910, year 2025, year:2024, best quality, amazing quality, very aesthetic, highres, incredibly absurdres, high detail, masterpiece, -3::simple illustration::, novel illustration, best illustration, -1::multiple views::, no text, -3::multiple view, people, crowd, 2koma, x-ray, internal cumshot::, 2::nsfw::,",
          "negative": "text, logo, cartoon, flat color, spot color, watermark, too many watermarks, blank page, text-only page, reference, username, signature, artist:xinzoruo, artist:milkpanda, artist collaboration, variant set, large variant set, 4koma, 2koma, toon (style), oekaki, chibi, turnaround, film grain, monochrome, dithering, halftone, screentones, dated, old, 1990s (style), mutation, deformed, distorted, disfigured, artistic error, distorted anatomy, anatomical structure error, asymmetrical face, unnatural hair, bad eyes, cloudy eyes, blank eyes, bad proportions, bad limb, bad hands, extra hands, bad hand structure, extra digits, fewer digits, bad legs, extra legs, amputee, distorted composition, bad perspective, multiple views, negative space, animation error, chromatic aberration, disorganized colors, scan artifacts, jpeg artifacts, vertical lines, vertical banding, worst quality, bad quality, lowres, blurry, upscaled, fewer details, unfinished, incomplete, amateur, cheesy, unsatisfactory, inadequate, deficient, subpar, poor, displeasing, very displeasing, bad illustration, bad portrait, limited palette, six finger, four finger, three finger, bad anatomy,"
        },
        {
          "id": "프리셋_쫀_6_815h6",
          "name": "프리셋 쫀",
          "positive": "nsfw, 2::blender (medium), 3D::, 8::realistic::, 8::realistic skin::, 20::high detail texture::, 4::hizuki akira, dishwasher1910,::, 0.5::kim hyung tae::, 0.15::kidmo::, 0.75::icecake::, 0.3::von.franken::, 0.9::kase daiki::, nixeu, 0.5::yd_(orange_maru) ::, artist:2n5, healthyman, 0.75::nonohachi::, 0.2::freng::, 0.2::tsunako::, 0.3::bara_(03_bara_) ::, 0.5::ishigaki takashi::, 0.6::wanke::, 2::wlop::, 12.2::zero_q_0q::, 12.2::bm94199,::, re0n, 0.2::yunsang::, 0.2::ie (raarami), sos adult::, 0.6::qiandaiyiyu::, year 2025, year 2024, 4::masterpiece, very aesthetic, best quality, incredibly absurdres, absurdres, ultra high resolution::, 0.7::ai-generated::, -2::multiple views::, -2::simple illustration::, -3::artist collaboration::, -10::blackbord::, 4::heavy breath::, 1.4::bedroom::, 1.2::sunlight::, 2.9::hotel::,",
          "negative": "8::watermark, too many watermarks,::, 2::text, logo, signature, Pictures, photos, brands, brand logos, dolls, other's, another's, painting, printing, print, letters, artist name, External characters, third party, outsiders, Except for designated characters::, 2::artist:nameo (judgemasterkou), artist:matsunaga kouyou::, artist collaboration, chibi, 1990s (style), bad anatomy, distorted anatomy, disfigured, 10::bad hands, missing finger, extra digits, mutation, extra arms, extra legs, long neck, bad feet, very displeasing, undetailed eyes, bad sole, bad toe, Deformed toe, deformed sole, mutant toe, mutant sole, deformed finger, deformed hand, deformed foot, deformed feet, mutant finger, mutant arm, mutant foot, mutant feet, extra hand, extra feet, extra foot, extra finger, extra toe, not five toes, not five fingers, Extra toes, extra fingers, six toes, four toes, Ugly feet, ugly toes, ugly hands, ugly fingers::, multiple views, negative space, blank page, variant set, large variant set, 4koma, 2koma, oekaki, halftone, screentone, artistic error, film grain, scan artifacts, jpeg artifacts, chromatic aberration, dithering, disorganized colors, lowres, worst quality, bad quality, cheesy, sloppiness, unfinished, Incomplete, **cartoon, anime, manga, 2d, flat color, cel shading, line art, sketch, blurry, out of focus, low contrast** 4, ::western face, caucasian, square jaw, angular jaw, square jawbone, angular jawbone, wide chin, chin dimple::, -6::five fingers, five toes, five finger, five toe, 5 fingers, 5 toes, 5 finger, 5 toe::,"
        },
        {
          "id": "프리셋_리얼_7_xwn4c",
          "name": "프리셋 리얼",
          "positive": "nsfw, 2::blender (medium), 3D::, 8::realistic::, 8::realistic skin::, 20::high detail texture::, 4::hizuki akira, dishwasher1910,::, 0.5::kim hyung tae::, 0.15::kidmo::, 0.75::icecake::, 0.3::von.franken::, 0.9::kase daiki::, nixeu, 0.5::yd_(orange_maru) ::, artist:2n5, healthyman, 0.75::nonohachi::, 0.2::freng::, 0.2::tsunako::, 0.3::bara_(03_bara_) ::, 0.5::ishigaki takashi::, 0.6::wanke::, 2::wlop::, 12.2::zero_q_0q::, 12.2::bm94199,::, re0n, 0.2::yunsang::, 0.2::ie (raarami), sos adult::, 0.6::qiandaiyiyu::, year 2025, year 2024, 4::masterpiece, very aesthetic, best quality, incredibly absurdres, absurdres, ultra high resolution::, 0.7::ai-generated::, -2::multiple views::, -2::simple illustration::, -3::artist collaboration::, -10::blackbord::, 4::heavy breath::,",
          "negative": "8::watermark, too many watermarks,::, 2::text, logo, signature, Pictures, photos, brands, brand logos, dolls, other's, another's, painting, printing, print, letters, artist name, External characters, third party, outsiders, Except for designated characters::, 2::artist:nameo (judgemasterkou), artist:matsunaga kouyou::, artist collaboration, chibi, 1990s (style), bad anatomy, distorted anatomy, disfigured, 10::bad hands, missing finger, extra digits, mutation, extra arms, extra legs, long neck, bad feet, very displeasing, undetailed eyes, bad sole, bad toe, Deformed toe, deformed sole, mutant toe, mutant sole, deformed finger, deformed hand, deformed foot, deformed feet, mutant finger, mutant arm, mutant foot, mutant feet, extra hand, extra feet, extra foot, extra finger, extra toe, not five toes, not five fingers, Extra toes, extra fingers, six toes, four toes, Ugly feet, ugly toes, ugly hands, ugly fingers::, multiple views, negative space, blank page, variant set, large variant set, 4koma, 2koma, oekaki, halftone, screentone, artistic error, film grain, scan artifacts, jpeg artifacts, chromatic aberration, dithering, disorganized colors, lowres, worst quality, bad quality, cheesy, sloppiness, unfinished, Incomplete, **cartoon, anime, manga, 2d, flat color, cel shading, line art, sketch, blurry, out of focus, low contrast** 4, ::western face, caucasian, square jaw, angular jaw, square jawbone, angular jawbone, wide chin, chin dimple::, -6::five fingers, five toes, five finger, five toe, 5 fingers, 5 toes, 5 finger, 5 toe::,"
        }
      ],
      active_preset_id: "프리셋_닭장_0_14izz",
      include_min: 0,
      include_max: 0,
      userchat: false,
      gallery_fab: false,
      floating_viewer: true,
      overlay_markers: true,
      llm_anchor_percent: true,
      natural_base: true,
      inline_previews: true,
      inline_thumb_pct: 100,
      scale_semantics_version: 2,
      // Pin position is overlay_*_pct (bottom-left). Do not default overlay_*_offset —
      // deepMerge would otherwise shadow saved percentages on every settings load.
      mobile_toggle_pin: false,
      hover_preview: true,
      hover_preview_anchor: "mouse",
      hover_preview_corner: "top-right",
      viewer_minimize_mode: "icon",
      unified_chat_priority: false,
      overlay_hide_offscreen: true,
      scroll_message_track: true,
      click_message_track: true,
      message_select_gesture: "single",
      text_drag_select: true,
      show_risu_settings_button: true,
      debug_panel: false,
      /** When true, auto image gen runs for user/char/any selected role. */
      generate_all_roles: false,
      /** When true, afterRequest creates images for the finished AI reply (no click). */
      auto_gen_on_reply: false,
      scroll_delay_ms: 250,
      capture_delay_ms: 10,
      overlay_x_pct: 38,
      overlay_y_pct: 80,
      overlay_pin_unit: "pct",
      overlay_pin_origin: "bl",
    },
    llm: {
      /** custom = plugin endpoint/key · main = Risu main · aux = Risu otherAx */
      source: "custom",
      provider: "openrouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      model: "openai/gpt-oss-20b:nitro",
      api_key: "",
      service_account_json: "",
      temperature: 0.4,
      max_tokens: 8000,
      timeout_seconds: 180,
      /** default | none | minimal | low | medium | high | xhigh | max */
      reasoning_effort: "default",
      vertex_region: "us-central1",
      anthropic_version: "2023-06-01",
    },
    nai: {
      provider: "Novel AI",
      /** nai | comfy */
      backend: "nai",
      request_url: "https://image.novelai.net/ai/generate-image",
      api_key: "",
      model: "nai-diffusion-4-5-full",
      width: 832,
      height: 1216,
      sampler: "k_euler_ancestral",
      scheduler: "karras",
      steps: 28,
      cfg_scale: 7.0,
      cfg_rescale: 0.36,
      seed: 0,
      variety_plus: false,
      enable_i2i: false,
      image_reference: "none",
      image_reference_strength: 0.6,
      image_reference_fidelity: 1.0,
      image_reference_type: "character&style",
      vibe_transfer: "none",
      vibe_transfer_strength: 0.6,
      vibe_transfer_information_extracted: 1.0,
      uc_preset: "human_focus",
      apply_quality_tags: false,
      comfy_url: "http://localhost:8188",
      comfy_workflow_json: "",
      backend_timeout_seconds: 300,
    },
  };

  const PROMPT_FALLBACKS = {
    author_note: "",
    tagger: "Tag the chat message into Danbooru-style English image prompts. Output ONE JSON object only.",
    format: '{"scenes":[{"place":"...","shots":[{"paragraph":0,"camera":"...","situation":"...","characters":[{"name":"...","action":"..."}]}]}],"new_characters":[]}',
    appearance_inject: "Registered: {registered_block}\nIncomplete: {incomplete_block}\nDetected: {detected_block}",
    lore_inject: "Use matched lorebook context:",
    char_inject: "Character info:",
    preprocess: "Summarize visual details from the message.",
    prefill: "",
    preset_1: "[Positive]\n, masterpiece, best quality\n\n[Negative]\nlowres, bad quality, watermark",
  };

  const QUALITY_TAGS = {
    "naid4.5f": ", location, very aesthetic, masterpiece, no text",
    "naid4.5c": ", location, masterpiece, no text, -0.8::feet::, rating:general",
    naid4f: ", no text, best quality, very aesthetic, absurdres",
    naid4c: ", rating:general, amazing quality, very aesthetic, absurdres",
    naid3: ", best quality, amazing quality, very aesthetic, absurdres",
  };

  const UC_PRESETS = {
    "naid4.5f": {
      heavy: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
      light: "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
      human_focus: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
      none: "",
    },
    "naid4.5c": {
      heavy: "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
      light: "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page",
      human_focus: "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page",
      none: "",
    },
    naid4f: {
      heavy: "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks",
      light: "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing",
      none: "",
    },
    naid4c: {
      heavy: "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts",
      light: "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature",
      none: "",
    },
    naid3: {
      heavy: "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
      light: "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing",
      human_focus: "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes",
      none: "",
    },
  };

  const MODELS = {
    "naid4.5f": "nai-diffusion-4-5-full",
    "naid4.5c": "nai-diffusion-4-5-curated",
    naid4f: "nai-diffusion-4-full",
    naid4c: "nai-diffusion-4-curated-preview",
    naid3: "nai-diffusion-3",
  };

  const CLOTHING_HINTS = [
    "shirt", "blouse", "pants", "trousers", "jeans", "shorts", "skirt", "dress",
    "jacket", "coat", "hoodie", "sweater", "cardigan", "vest", "waistcoat",
    "uniform", "armor", "robe", "cloak", "cape", "apron", "overalls",
    "leggings", "stockings", "tights", "pantyhose", "socks", "thighhighs",
    "boots", "shoes", "heels", "sandals", "slippers", "footwear", "barefoot",
    "gloves", "mittens", "hat", "cap", "beret", "hood", "scarf", "necktie",
    "bowtie", "tie", "belt", "bra", "panties", "underwear", "lingerie",
    "swimsuit", "bikini", "kimono", "yukata", "hakama", "cheongsam", "hanbok",
    "suit", "tuxedo", "collar", "choker", "mask", "helmet",
    "nude", "naked", "topless", "bottomless", "completely nude",
    "open shirt", "unbuttoned", "unzipped", "torn clothes", "clothes",
    "clothing", "outfit", "attire", "sleeves", "rolled-up sleeves",
    "long sleeves", "short sleeves", "sleeveless", "off shoulder",
    "bare shoulders", "midriff", "navel", "cleavage", "garter", "corset",
    "bodysuit", "leotard", "fishnets", "ribbon", "bow", "bandana",
    "no shirt", "no pants", "shirt lift", "panties pull", "skirt lift",
  ];

  /** Jewelry, bags, weapons, held props, ID gear — not body identity, not clothes. */
  const ACCESSORY_HINTS = [
    "necklace", "earring", "earrings", "bracelet", "ring", "pendant", "brooch",
    "bag", "backpack", "purse", "handbag", "briefcase", "suitcase", "pouch", "satchel",
    "watch", "wristwatch", "wristband", "badge", "id card", "lanyard", "name badge", "nameplate",
    "glasses", "sunglasses", "goggles", "monocle",
    "crown", "tiara", "veil",
    "sword", "katana", "knife", "dagger", "gun", "pistol", "rifle", "spear", "axe",
    "staff", "wand", "blade", "weapon", "shield", "crossbow", "scythe", "hammer",
    "umbrella", "phone", "smartphone", "book", "clipboard", "folder", "cigarette",
    "microphone", "camera", "holding",
    // Audio wearables — LLM often re-injects these into accessories after a manual clear.
    "airpods", "earbuds", "earbud", "earphones", "earphone", "headphones", "headset",
    "in one ear", "wireless earbuds",
  ];

  const PERSON_TAG_MODES = ["off", "girls", "people", "gender"];
  const _FEMALE_RE = /\b(?:\d+\+?)?girls?\b|\bwom(?:an|en)\b|\bfemale\b|\blady\b|\bladies\b|\bmilf\b|\bloli\b|\bmaiden\b/i;
  const _MALE_RE = /\b(?:\d+\+?)?boys?\b|\bm(?:a|e)n\b|\bmale\b|\bguys?\b|\bgentleman\b|\botoko\b/i;
  const _PERSON_COUNT_TAG_RE = /^\d+\+?(?:girls?|boys?|people|person)$/i;

  const blobUrlCache = new Map();
  const memStores = {
    meta: new Map(),
    cards: new Map(),
    characters: new Map(),
    jobs: new Map(),
    images: new Map(),
  };
  let storeReady = null;
  let persistChain = Promise.resolve();
  let nexus = null;
  let readyPromise = null;
  let generateMutex = Promise.resolve();

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function cleanText(value, limit = 200000) {
    if (value == null) return "";
    let text = String(value).replace(/\x00/g, " ").replace(/\r\n/g, "\n");
    text = text.replace(/[ \t\f\v]+/g, " ").replace(/\n{4,}/g, "\n\n\n").trim();
    return text.slice(0, limit);
  }

  /** custom | main (Risu) | aux (Risu otherAx) */
  function normalizeLlmSource(value) {
    const s = String(value || "").trim().toLowerCase();
    if (s === "main" || s === "risu_main" || s === "risu-main") return "main";
    if (s === "aux" || s === "otherax" || s === "other_ax" || s === "risu_aux" || s === "risu-aux" || s === "sub" || s === "secondary") return "aux";
    return "custom";
  }

  function llmIsRisuSource(value) {
    const s = normalizeLlmSource(value);
    return s === "main" || s === "aux";
  }

  function llmHelpers() {
    return globalThis.__INLAY_LLM__ || {};
  }

  function normalizeLlmProviderFallback(raw) {
    const p = String(raw || "").toLowerCase().replace(/[ -]+/g, "_");
    if (p === "openai_compatible" || p === "openai_compat") return "openrouter";
    if (["google", "gemini", "google_ai"].includes(p)) return "google_ai";
    if (["vertex", "vertex_ai"].includes(p)) return "vertex";
    if (["anthropic", "anthropic_compatible", "claude"].includes(p)) return "anthropic_compatible";
    if (["lmstudio", "lm_studio"].includes(p)) return "lmstudio";
    if (p === "ollama") return "ollama";
    if (p === "openai") return "openai";
    if (p === "openrouter") return "openrouter";
    return "custom";
  }

  function llmConfigured(llm) {
    const cfg = llm || {};
    if (llmIsRisuSource(cfg.source)) return true;
    const provider = llmHelpers().normalizeLlmProvider?.(cfg.provider) || String(cfg.provider || "");
    if (provider === "vertex") {
      return Boolean(cleanText(cfg.model) && (cleanText(cfg.api_key) || cleanText(cfg.service_account_json)));
    }
    return Boolean(cleanText(cfg.model) && cleanText(cfg.api_key));
  }

  function b64urlJson(value) {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function b64urlBytes(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function googleAccessTokenFromServiceAccount(saJson) {
    let sa;
    try {
      sa = typeof saJson === "string" ? JSON.parse(saJson) : saJson;
    } catch {
      throw new Error("Vertex Service Account JSON 파싱 실패");
    }
    if (!sa?.client_email || !sa?.private_key) {
      throw new Error("Service Account JSON에 client_email/private_key가 필요합니다.");
    }
    if (!globalThis.crypto?.subtle) {
      throw new Error("이 환경에서는 Vertex Service Account(JWT) 서명을 지원하지 않습니다. API key 칸에 OAuth access token을 넣거나 Google AI Studio를 쓰세요.");
    }
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64urlJson({ alg: "RS256", typ: "JWT" })}.${b64urlJson({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })}`;
    const pem = String(sa.private_key).replace(/\\n/g, "\n");
    const pemBody = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
    const raw = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "pkcs8",
      raw,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
    const jwt = `${input}.${b64urlBytes(sig)}`;
    const resp = await networkFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
    });
    let data = {};
    try {
      data = await resp.json();
    } catch {
      data = {};
    }
    if (!data?.access_token) {
      throw new Error(`Vertex 토큰 발급 실패: ${JSON.stringify(data).slice(0, 240)}`);
    }
    return {
      accessToken: String(data.access_token),
      projectId: cleanText(sa.project_id || ""),
    };
  }

  function openaiMessagesToAnthropic(messages) {
    let system = "";
    const out = [];
    for (const row of messages || []) {
      const role = String(row?.role || "");
      if (role === "system") {
        const content = typeof row?.content === "string"
          ? row.content
          : Array.isArray(row?.content)
            ? row.content.map((part) => (typeof part === "object" ? part.text || "" : String(part))).join("")
            : String(row?.content ?? "");
        system = system ? `${system}\n${content}` : content;
        continue;
      }
      if (Array.isArray(row?.content)) {
        const parts = [];
        for (const part of row.content) {
          if (!part || typeof part !== "object") {
            const t = String(part || "").trim();
            if (t) parts.push({ type: "text", text: t });
            continue;
          }
          const url = part.image_url?.url || (typeof part.image_url === "string" ? part.image_url : "");
          if (part.type === "image_url" || url) {
            const m = String(url).match(/^data:([^;]+);base64,([\s\S]+)$/i);
            if (m) {
              parts.push({
                type: "image",
                source: { type: "base64", media_type: m[1] || "image/png", data: m[2].replace(/\s+/g, "") },
              });
            }
            continue;
          }
          const t = String(part.text || "").trim();
          if (t) parts.push({ type: "text", text: t });
        }
        out.push({
          role: role === "assistant" ? "assistant" : "user",
          content: parts.length ? parts : [{ type: "text", text: "" }],
        });
        continue;
      }
      out.push({
        role: role === "assistant" ? "assistant" : "user",
        content: String(row?.content ?? ""),
      });
    }
    return { system, messages: out };
  }

  function extractChatCompletionText(payload) {
    const choices = payload?.choices || [];
    if (!choices.length) throw new Error("LLM returned no choices.");
    const message = choices[0].message || {};
    let content = message.content;
    if (Array.isArray(content)) {
      content = content.map((part) => (typeof part === "object" ? part.text || "" : String(part))).join("");
    }
    // Some reasoning models put final text in content; keep content only (ignore reasoning fields).
    return cleanText(content);
  }

  function extractAnthropicText(payload) {
    const blocks = Array.isArray(payload?.content) ? payload.content : [];
    const text = blocks
      .map((block) => (block && typeof block === "object" ? block.text || "" : String(block || "")))
      .join("");
    const out = cleanText(text || payload?.completion || "");
    if (!out) throw new Error("Anthropic 응답이 비어 있습니다.");
    return out;
  }

  async function readStreamToText(stream) {
    if (!stream || typeof stream.getReader !== "function") return "";
    const reader = stream.getReader();
    const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
    let lastObjText = "";
    let byteText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (typeof value === "string") {
        lastObjText = value;
        byteText += value;
      } else if (value instanceof Uint8Array) {
        byteText += decoder ? decoder.decode(value, { stream: true }) : "";
      } else if (value && typeof value === "object") {
        // Risu StreamResponseChunk: { "0": cumulativeFullText }
        if (typeof value["0"] === "string") lastObjText = value["0"];
        else if (typeof value.content === "string") lastObjText = value.content;
        else if (typeof value.text === "string") lastObjText = value.text;
      }
    }
    if (decoder) byteText += decoder.decode();
    return lastObjText || byteText;
  }

  /**
   * Normalize Risu runLLMModel / OpenAI-like responses to plain text.
   * Risu returns { type: 'success'|'fail'|'streaming', result } — not raw chat completion.
   */
  async function llmResponseToText(response) {
    if (typeof response === "string") return response;
    if (response && typeof response.getReader === "function") {
      return readStreamToText(response);
    }
    if (response == null) return "";
    if (typeof response === "number" || typeof response === "boolean") return String(response);
    if (typeof response === "object") {
      const risuType = cleanText(response.type, 40).toLowerCase();
      if (risuType === "fail" || risuType === "error") {
        const errMsg = cleanText(response.result || response.message || response.error || "Risu LLM 실패", 800);
        throw new Error(`Risu LLM 실패: ${errMsg}`);
      }
      if (risuType === "streaming" || risuType === "stream") {
        const stream = response.result ?? response.data ?? response.stream;
        const streamed = await readStreamToText(stream);
        if (streamed.trim()) return streamed;
      }
      if (risuType === "success" || risuType === "ok") {
        const ok = response.result ?? response.data ?? response.content;
        if (typeof ok === "string") return ok;
        if (ok && typeof ok.getReader === "function") return readStreamToText(ok);
      }

      const preferred = [
        response?.choices?.[0]?.message?.content,
        response?.choices?.[0]?.text,
        response?.choices?.[0]?.delta?.content,
        response?.message?.content,
        response?.content,
        response?.text,
        response?.response,
        // Prefer unwrapping only after typed Risu handling above.
        risuType ? null : response?.result,
        response?.output,
      ];
      for (const part of preferred) {
        if (typeof part === "string" && part.trim()) return part;
        if (Array.isArray(part)) {
          const joined = part.map((p) => (typeof p === "object" ? p?.text || "" : String(p || ""))).join("");
          if (joined.trim()) return joined;
        }
        if (part && typeof part.getReader === "function") {
          const streamed = await readStreamToText(part);
          if (streamed.trim()) return streamed;
        }
      }
      try {
        return JSON.stringify(response);
      } catch (_) {
        return String(response);
      }
    }
    return String(response || "");
  }

  function deepcopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function deepMerge(base, overlay) {
    const out = deepcopy(base || {});
    for (const [key, value] of Object.entries(overlay || {})) {
      if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
        out[key] = deepMerge(out[key], value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  function toInt(value, defaultVal = -1) {
    try {
      if (value == null || (typeof value === "string" && !String(value).trim())) return defaultVal;
      return parseInt(value, 10);
    } catch (_) {
      return defaultVal;
    }
  }

  function toOptionalFloat(value) {
    if (value == null || (typeof value === "string" && !String(value).trim())) return null;
    try {
      return parseFloat(value);
    } catch (_) {
      return null;
    }
  }

  function joinTags(...parts) {
    const items = [];
    const seen = new Set();
    for (const part of parts) {
      for (const token of cleanText(part).split(",")) {
        const t = token.trim();
        if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "none") continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(t);
      }
    }
    return items.join(", ");
  }

  function normalizeAlias(value) {
    return cleanText(value, 200).toLowerCase().replace(/\s+/g, " ");
  }

  function _compact(text) {
    return cleanText(text).toLowerCase().replace(/\s+/g, "");
  }

  function parseAliasList(value) {
    if (value == null) return [];
    let raw;
    if (Array.isArray(value)) {
      raw = value.map((v) => cleanText(v, 200));
    } else {
      const text = cleanText(value, 2000);
      raw = text ? text.split(/[,|/]|,(?=\s)|、|\//) : [];
      if (raw.length <= 1 && text) raw = text.split(/\n+/);
    }
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const cleaned = cleanText(item, 200);
      if (!cleaned) continue;
      const key = normalizeAlias(cleaned);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
    return out;
  }

  function _aliasTokenOk(token, allowShort = false) {
    token = cleanText(token, 200);
    if (!token) return false;
    const compact = _compact(token);
    if (!compact) return false;
    if (!allowShort && compact.length < 2) return false;
    if (/^[a-zA-Z]+$/.test(token) && token.length < 3) return false;
    return true;
  }

  function expandAliasParts(...values) {
    const seeds = [];
    for (const v of values) seeds.push(...parseAliasList(v));
    const out = [];
    const seen = new Set();
    const add = (item, allowShort = false) => {
      item = cleanText(item, 200);
      if (!_aliasTokenOk(item, allowShort)) return;
      const key = normalizeAlias(item);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    };
    for (const seed of seeds) {
      add(seed, true);
      const parts = seed.split(/[\s\-·•･]+/).filter(Boolean);
      for (const part of parts) add(part, parts.length === 1);
      if (parts.length >= 3) {
        for (let i = 0; i < parts.length - 1; i++) add(`${parts[i]} ${parts[i + 1]}`);
      }
    }
    return out;
  }

  function isAccessoryTag(tag) {
    const low = cleanText(tag).toLowerCase();
    if (!low) return false;
    return ACCESSORY_HINTS.some((hint) => low.includes(hint));
  }

  function isClothingTag(tag) {
    const low = cleanText(tag).toLowerCase();
    if (!low) return false;
    if (isAccessoryTag(low)) return false;
    return CLOTHING_HINTS.some((hint) => low.includes(hint));
  }

  /** Split tags → [identity, attire(clothes), accessories(jewelry/weapons/props)]. */
  function splitLookTags(tags) {
    const identity = [];
    const attire = [];
    const accessories = [];
    for (const token of cleanText(tags).split(",")) {
      const t = token.trim();
      if (!t) continue;
      if (isAccessoryTag(t)) accessories.push(t);
      else if (isClothingTag(t)) attire.push(t);
      else identity.push(t);
    }
    return [joinTags(...identity), joinTags(...attire), joinTags(...accessories)];
  }

  function splitIdentityAndAttire(tags) {
    const [identity, attire] = splitLookTags(tags);
    return [identity, attire];
  }

  function replaceAttire(appearance, attire, accessories, newAttire) {
    const [identity, oldAttire, oldAcc] = splitLookTags(joinTags(appearance, attire, accessories));
    const incoming = cleanText(newAttire);
    if (!incoming) return [identity, oldAttire, oldAcc];
    const [extraId, clothing, acc] = splitLookTags(incoming);
    return [
      joinTags(identity, extraId),
      clothing || (!acc ? incoming : oldAttire),
      acc || oldAcc,
    ];
  }

  function replaceAccessories(appearance, attire, accessories, newAccessories) {
    const [identity, oldAttire, oldAcc] = splitLookTags(joinTags(appearance, attire, accessories));
    const incoming = cleanText(newAccessories);
    if (!incoming) return [identity, oldAttire, oldAcc];
    const [extraId, clothing, acc] = splitLookTags(incoming);
    return [
      joinTags(identity, extraId),
      joinTags(oldAttire, clothing),
      acc || incoming,
    ];
  }

  function characterTriggers(char) {
    const migrated = globalThis.__INLAY_IDENTITY__?.migrateCharacter?.(char) || char || {};
    const out = parseAliasList([migrated.name, ...(migrated.aliases || [])]);
    const surnames = parseAliasList([migrated.surname, ...(migrated.surname_variants || [])]);
    const givenNames = parseAliasList([migrated.given_name, ...(migrated.given_name_variants || [])]);
    for (const surname of surnames) {
      for (const given of givenNames) {
        out.push(`${surname} ${given}`, `${surname}${given}`, `${given} ${surname}`);
      }
    }
    return parseAliasList(out).filter((token) => {
      const isSurnameOnly = surnames.some((surname) => normalizeAlias(surname) === normalizeAlias(token));
      return !isSurnameOnly;
    });
  }

  function classifyGenderFromTags(...parts) {
    const text = joinTags(...parts.filter((p) => p != null).map((p) => cleanText(p)));
    if (!text) return null;
    const femaleHits = (text.match(_FEMALE_RE) || []).length;
    const maleHits = (text.match(_MALE_RE) || []).length;
    if (femaleHits > maleHits) return "f";
    if (maleHits > femaleHits) return "m";
    return null;
  }

  function formatCountTag(n, one, many, manyPlus) {
    if (n <= 0) return "";
    if (n === 1) return one;
    if (n <= 5) return `${n}${many}`;
    return manyPlus;
  }

  function formatPersonCountTags(female, male) {
    const parts = [];
    const girl = formatCountTag(female, "1girl", "girls", "6+girls");
    const boy = formatCountTag(male, "1boy", "boys", "6+boys");
    if (girl) parts.push(girl);
    if (boy) parts.push(boy);
    return parts.join(", ");
  }

  function stripPersonCountTags(tags) {
    const kept = [];
    for (const token of cleanText(tags).split(",")) {
      const t = token.trim();
      if (!t) continue;
      if (_PERSON_COUNT_TAG_RE.test(t)) continue;
      kept.push(t);
    }
    return joinTags(...kept);
  }

  function normalizeCharacterCaptionTags(tags) {
    const kept = [];
    const seen = new Set();
    for (const token of cleanText(tags).split(",")) {
      let t = token.trim();
      if (!t) continue;
      if (_PERSON_COUNT_TAG_RE.test(t)) {
        const low = t.toLowerCase();
        if (low.includes("girl")) t = "girl";
        else if (low.includes("boy")) t = "boy";
        else continue;
      }
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(t);
    }
    return joinTags(...kept);
  }

  function normalizePersonTagMode(value, legacyAuto = null) {
    if (value == null && legacyAuto != null) value = legacyAuto;
    if (value === false) return "off";
    if (value === true) return "gender";
    const text = cleanText(value, 40).toLowerCase();
    if (["", "auto", "mixed", "true", "1", "on"].includes(text)) return "gender";
    if (["off", "none", "false", "0", "disable", "disabled"].includes(text)) return "off";
    if (["girl", "all_girls", "girls_only"].includes(text)) return "girls";
    if (["person", "persons"].includes(text)) return "people";
    if (PERSON_TAG_MODES.includes(text)) return text;
    return "gender";
  }

  function resolveCharacter(name, characters) {
    const helper = globalThis.__INLAY_IDENTITY__?.resolveCharacterIdentity;
    if (typeof helper === "function") return helper(name, characters || []);
    const target = normalizeAlias(name);
    if (!target) return null;
    const matches = (characters || []).filter((char) => characterTriggers(char).some((trigger) => normalizeAlias(trigger) === target));
    return matches.length === 1 ? matches[0] : null;
  }

  function personCountTagsForShot(chars, roster, mode = "gender", legacyAuto = null) {
    const modeKey = normalizePersonTagMode(mode, legacyAuto);
    if (modeKey === "off") return "";
    const cast = (chars || []).slice(0, 6);
    const n = cast.length;
    if (n <= 0) return "";
    if (modeKey === "girls") return formatCountTag(n, "1girl", "girls", "6+girls");
    if (modeKey === "people") return formatCountTag(n, "1person", "people", "6+people");
    let female = 0;
    let male = 0;
    for (const char of cast) {
      const name = cleanText(char.name, 200);
      const stored = name ? resolveCharacter(name, roster) : null;
      const gender = classifyGenderFromTags(
        stored?.appearance,
        stored?.attire,
        stored?.accessories,
        char.sex,
        char.label,
        char.age,
        char.appearance,
        char.body,
        char.attire,
        char.accessories,
      );
      if (gender === "f") female++;
      else if (gender === "m") male++;
    }
    return formatPersonCountTags(female, male);
  }

  function fullTags(char) {
    return joinTags(char?.original || "", char?.appearance || "", char?.attire || "", char?.accessories || "");
  }

  function characterHasAppearance(char) {
    if (typeof char !== "object" || char === null) return false;
    let appearance = cleanText(char.appearance || "", 4000);
    if (!appearance) return false;
    // original-only leftovers in appearance are not a filled look
    const original = cleanText(char.original || "", 400);
    if (original) {
      appearance = joinTags(
        ...appearance.split(",").filter((t) => normalizeAlias(t) !== normalizeAlias(original)),
      );
    }
    // clothing misfiled into appearance does not count as identity
    const [identity] = splitIdentityAndAttire(appearance);
    appearance = cleanText(identity || "", 4000);
    if (!appearance) return false;
    // gender / person-count only → treat as empty so LLM re-collects looks
    const weak = new Set(["girl", "boy", "man", "woman", "male", "female", "1girl", "1boy", "2girls", "2boys", "solo", "other"]);
    const meaningful = appearance
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .filter((t) => !weak.has(t) && !/^\d+(girl|boy)s?$/.test(t));
    return meaningful.length > 0;
  }

  /** Merge duplicate cast entries that resolve to the same roster/name alias (LLM sometimes doubles char1/char2). */
  function dedupeShotCharacters(chars, roster, charMax = 6) {
    const limit = Math.max(1, Math.min(6, Number(charMax) || 6));
    const out = [];
    const seen = new Set();
    const mergeFields = (dst, src) => {
      if (!dst || !src) return dst;
      for (const key of ["action", "expression", "attire", "accessories", "appearance", "label", "age", "body", "sex", "original", "original_tag", "negative"]) {
        const cur = cleanText(dst[key] || "", 2000);
        const add = cleanText(src[key] || "", 2000);
        if (!add) continue;
        if (!cur) dst[key] = add;
        else if (!cur.toLowerCase().includes(add.toLowerCase())) dst[key] = joinTags(cur, add);
      }
      return dst;
    };
    for (const raw of chars || []) {
      if (!raw || typeof raw !== "object") continue;
      const name = cleanText(raw.name, 200);
      if (!name) continue;
      const stored = resolveCharacter(name, roster);
      const key = stored
        ? `id:${cleanText(stored.id || stored.name, 200)}`
        : `name:${normalizeAlias(name)}`;
      if (!key || key === "id:" || key === "name:") continue;
      const idx = out.findIndex((item) => item._dedupeKey === key);
      if (idx >= 0) {
        mergeFields(out[idx], raw);
        continue;
      }
      if (out.length >= limit) continue;
      seen.add(key);
      out.push({
        ...raw,
        name: stored?.name || name,
        _dedupeKey: key,
      });
    }
    return out.map(({ _dedupeKey, ...rest }) => rest);
  }

  function _characterAliasKeys(char) {
    const keys = new Set();
    for (const token of characterTriggers(char)) {
      const key = normalizeAlias(token);
      if (key) keys.add(key);
    }
    const name = normalizeAlias(char?.name);
    if (name) keys.add(name);
    return keys;
  }

  function mergeCharactersByAlias(characters) {
    const helper = globalThis.__INLAY_IDENTITY__?.mergeCharacterView;
    if (typeof helper === "function") return helper(characters || []).active;
    const sameId = globalThis.__INLAY_IDENTITY__?.sameFullNameIdentity;
    const items = (characters || []).filter((c) => typeof c === "object" && cleanText(c.name, 200));
    if (!items.length) return [];
    const n = items.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (i, j) => {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[rj] = ri;
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const hit = typeof sameId === "function"
          ? sameId(items[i], items[j])
          : false;
        if (hit) union(i, j);
      }
    }
    const groups = new Map();
    items.forEach((char, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(char);
    });
    const merged = [];
    for (const members of groups.values()) {
      const aliases = [];
      const seen = new Set();
      let bestName = "";
      let bestNameScore = -1;
      let bestAppearance = "";
      let bestAttire = "";
      let bestAccessories = "";
      let bestOriginal = "";
      let bestId = "";
      let bestSurname = "";
      let bestGiven = "";
      const surnameVariants = [];
      const givenVariants = [];
      for (const char of members) {
        const name = cleanText(char.name, 200);
        const score = normalizeAlias(name).length + (char.aliases || []).length;
        if (score > bestNameScore) {
          bestNameScore = score;
          bestName = name;
        }
        if (!bestId) bestId = cleanText(char.id || "", 200);
        if (!bestSurname) bestSurname = cleanText(char.surname || "", 200);
        if (!bestGiven) bestGiven = cleanText(char.given_name || "", 200);
        for (const token of [name, ...(char.aliases || [])]) {
          const t = cleanText(token, 200);
          const key = normalizeAlias(t);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          aliases.push(t);
        }
        for (const token of parseAliasList([char.surname, ...(char.surname_variants || [])])) surnameVariants.push(token);
        for (const token of parseAliasList([char.given_name, ...(char.given_name_variants || [])])) givenVariants.push(token);
        const appearance = cleanText(char.appearance || "", 4000);
        const attire = cleanText(char.attire || "", 4000);
        const accessories = cleanText(char.accessories || "", 4000);
        const original = cleanText(char.original || "", 400);
        if (appearance.length > bestAppearance.length) bestAppearance = appearance;
        if (attire.length > bestAttire.length) bestAttire = attire;
        if (accessories.length > bestAccessories.length) bestAccessories = accessories;
        if (original && !bestOriginal) bestOriginal = original;
      }
      if (!bestName) continue;
      if (!aliases.includes(bestName)) aliases.unshift(bestName);
      const rec = {
        id: bestId || bestName,
        name: bestName,
        aliases,
        surname: bestSurname,
        given_name: bestGiven,
        surname_variants: parseAliasList(surnameVariants),
        given_name_variants: parseAliasList(givenVariants),
        original: bestOriginal,
        appearance: bestAppearance,
        attire: bestAttire,
        accessories: bestAccessories,
      };
      rec.tags = fullTags(rec);
      merged.push(rec);
    }
    merged.sort((a, b) => normalizeAlias(a.name).localeCompare(normalizeAlias(b.name)));
    return merged;
  }

  function loreEntryKeys(entry) {
    let raw = entry.key || entry.keys || entry.trigger || "";
    let parts;
    if (Array.isArray(raw)) parts = raw.map((x) => cleanText(x, 200));
    else {
      const text = cleanText(raw, 2000);
      parts = text ? text.split(/[,|\n]/) : [];
    }
    const second = entry.secondkey || entry.second_key || "";
    if (second) parts.push(...parseAliasList(second));
    const out = [];
    const seen = new Set();
    for (const part of parts) {
      const p = cleanText(part, 200);
      const key = normalizeAlias(p);
      const compact = p ? _compact(p) : "";
      if (!key || seen.has(key)) continue;
      if (p.startsWith("\uf000")) continue;
      if (compact.length < 2) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  function loreExtraApi() {
    return globalThis.__INLAY_LORE_EXTRA__ || {};
  }

  function isCharacterImageExtraLore(entry) {
    const api = loreExtraApi();
    if (typeof api.isCharacterImageExtraLore === "function") return api.isCharacterImageExtraLore(entry);
    const name = cleanText(entry?.comment || entry?.name || "", 200).toLowerCase();
    return name === "lb-xnai.lb.extra";
  }

  function trimCharacterImageTagLore(content, filledNames, keepNames) {
    const api = loreExtraApi();
    if (typeof api.trimCharacterImageTagLore === "function") {
      return api.trimCharacterImageTagLore(content, filledNames, keepNames);
    }
    return "";
  }

  function matchCharacterImageSectionTitles(content, message, triggerAliases = []) {
    const api = loreExtraApi();
    if (typeof api.matchCharacterImageSectionTitles === "function") {
      return api.matchCharacterImageSectionTitles(content, message, triggerAliases);
    }
    return [];
  }

  function loreKeyHitsMessage(key, hay, hayCompact) {
    const nk = normalizeAlias(key);
    const ck = _compact(key);
    if (ck.length < 2) return 0;
    const countOcc = (haystack, needle) => {
      if (!haystack || !needle || needle.length < 2) return 0;
      let n = 0;
      let from = 0;
      while (from <= haystack.length - needle.length) {
        const at = haystack.indexOf(needle, from);
        if (at < 0) break;
        n += 1;
        from = at + needle.length;
      }
      return n;
    };
    return Math.max(countOcc(hay, nk), countOcc(hayCompact, ck));
  }

  /** All trigger keys from lore entries that hit the message (not only the hitting key). */
  function collectTriggeredLoreKeys(entries, message) {
    const hay = cleanText(message).toLowerCase();
    const hayCompact = _compact(message);
    if (!hay) return [];
    const out = [];
    const seen = new Set();
    for (const entry of entries || []) {
      if (typeof entry !== "object" || isCharacterImageExtraLore(entry)) continue;
      const mode = cleanText(entry.mode || "", 40).toLowerCase();
      const keyRaw = cleanText(entry.key || "", 2000);
      if (mode === "folder" || keyRaw.startsWith("\uf000folder:")) continue;
      const keys = loreEntryKeys(entry);
      if (!keys.length) continue;
      let hits = 0;
      for (const key of keys) hits += loreKeyHitsMessage(key, hay, hayCompact);
      if (hits <= 0) continue;
      for (const key of keys) {
        const nk = normalizeAlias(key);
        if (!nk || seen.has(nk)) continue;
        seen.add(nk);
        out.push(key);
      }
    }
    return out;
  }

  /**
   * Trigger-matched lore + lb-xnai.lb.extra sections unlocked by those lore triggers.
   * Example: message "윤지수…" hits 윤지수 lore whose keys include "Yoon Ji-soo"
   * → only the Yoon Ji-soo section from lb-xnai.lb.extra is injected.
   */
  /** True when content still looks like the whole Character Image Tags dump. */
  function isUntrimmedCharacterImageTagDump(content, keepNames = []) {
    const text = String(content || "");
    if (!/character\s*image\s*tags/i.test(text)) return false;
    const heads = text.match(/^#{2,3}\s+.+$/gm) || [];
    const sectionHeads = heads.filter((h) => !/character\s*image\s*tags/i.test(h));
    const keep = Array.isArray(keepNames) ? keepNames.filter(Boolean).length : 0;
    // More character sections than unlocked names → still the whole file.
    return sectionHeads.length >= 3 && (keep === 0 || sectionHeads.length > keep + 1);
  }

  /** Name + trigger aliases for roster rows that already have appearance (used to drop lb-xnai sections). */
  function filledNamesForLoreExtra(roster) {
    const out = [];
    const seen = new Set();
    for (const char of roster || []) {
      if (!characterHasAppearance(char)) continue;
      for (const token of characterTriggers(char)) {
        const text = cleanText(token, 200);
        const key = normalizeAlias(text);
        if (!text || !key || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
      }
    }
    return out;
  }

  /** Normalize card.lore_extra → "tags" | "full" | "off". */
  function normalizeLoreExtraMode(value) {
    if (value === false || value === "false" || value === "off" || value === "none") return "off";
    if (value === "full") return "full";
    return "tags"; // true / "tags" / "sections" / unset
  }

  function assembleLorebookForTagger(entries, message, filledNames = [], limit = 5, contentLimit = 1200, triggerKeysOverride = null, loreExtraMode = "tags") {
    const list = Array.isArray(entries) ? entries : [];
    const mode = normalizeLoreExtraMode(loreExtraMode);
    // All lb-xnai.lb.extra entries (UI may already have pre-trimmed copies).
    const extras = mode === "off" ? [] : list.filter((e) => isCharacterImageExtraLore(e));
    const others = list.filter((e) => !isCharacterImageExtraLore(e));
    const matched = filterLorebookByMessage(others, message, limit, contentLimit);
    const triggeredKeys = Array.isArray(triggerKeysOverride) && triggerKeysOverride.length
      ? triggerKeysOverride.map((k) => cleanText(k, 200)).filter(Boolean)
      : collectTriggeredLoreKeys(others, message);
    const out = [];
    for (const extra of extras) {
      const raw = cleanText(extra.content || extra.data || "", 50000);
      if (!raw) continue;
      if (mode === "full") {
        // Whole lore entry as-is (may include custom prompt text + all character tags).
        out.push({
          comment: cleanText(extra.comment || extra.name || "lb-xnai.lb.extra", 200),
          content: raw,
          key: "full",
          always: true,
          lore_extra_mode: "full",
        });
      } else {
        const keepNames = matchCharacterImageSectionTitles(raw, message, triggeredKeys);
        // Empty trim = unlocked sections already filled (name/alias) → omit, do not re-inject raw.
        const trimmed = keepNames.length
          ? trimCharacterImageTagLore(raw, filledNames, keepNames)
          : "";
        if (trimmed && !isUntrimmedCharacterImageTagDump(trimmed, keepNames)) {
          out.push({
            comment: cleanText(extra.comment || extra.name || "lb-xnai.lb.extra", 200),
            content: trimmed,
            key: keepNames.join(", "),
            always: true,
            lore_extra_mode: "tags",
          });
        }
      }
    }
    for (const entry of matched) {
      // Belt-and-suspenders: never let a normal lore slot carry the full dump.
      const content = cleanText(entry.content || entry.data || "", contentLimit);
      if (isUntrimmedCharacterImageTagDump(content, [])) continue;
      out.push(entry);
    }
    return out;
  }

  function filterLorebookByMessage(entries, message, limit = 5, contentLimit = 1200) {
    const hay = cleanText(message).toLowerCase();
    const hayCompact = _compact(message);
    if (!hay) return [];
    const scored = [];
    for (const entry of entries || []) {
      if (typeof entry !== "object") continue;
      if (isCharacterImageExtraLore(entry)) continue;
      const mode = cleanText(entry.mode || "", 40).toLowerCase();
      const keyRaw = cleanText(entry.key || "", 2000);
      if (mode === "folder" || keyRaw.startsWith("\uf000folder:")) continue;
      const content = cleanText(entry.content || entry.data || "", contentLimit);
      if (!content) continue;
      const keys = loreEntryKeys(entry);
      if (!keys.length) continue;
      let hits = 0;
      for (const key of keys) hits += loreKeyHitsMessage(key, hay, hayCompact);
      if (hits <= 0) continue;
      scored.push({
        comment: cleanText(entry.comment || entry.name || "", 200),
        content,
        key: keyRaw,
        hits,
      });
    }
    scored.sort((a, b) => b.hits - a.hits || String(a.comment).localeCompare(String(b.comment)));
    return scored.slice(0, Math.max(1, limit)).map(({ hits, ...rest }) => rest);
  }

  function matchCharactersInText(text, characters) {
    const hay = cleanText(text).toLowerCase();
    const hayCompact = _compact(text);
    if (!hay) return [];
    const matched = [];
    const seenIds = new Set();
    for (const char of characters || []) {
      const cid = cleanText(char.id || char.name, 200);
      if (!cid || seenIds.has(cid)) continue;
      for (const trigger of characterTriggers(char)) {
        const key = normalizeAlias(trigger);
        const compact = _compact(trigger);
        if (compact.length < 2) continue;
        if (hay.includes(key) || hayCompact.includes(compact)) {
          matched.push(char);
          seenIds.add(cid);
          break;
        }
      }
    }
    return matched;
  }

  function normalizeCharacterRecord(raw, fallbackName = "") {
    if (typeof raw !== "object" || raw === null) return null;
    const name = cleanText(raw.name || fallbackName, 200);
    if (!name) return null;
    let aliases = parseAliasList(raw.aliases);
    aliases = [name, ...aliases.filter((a) => normalizeAlias(a) !== normalizeAlias(name))];
    const original = cleanText(raw.original || raw.original_tag || raw.copyright || "", 400);
    let appearance = cleanText(raw.appearance || "", 4000);
    let attire = cleanText(raw.attire || "", 4000);
    let accessories = cleanText(raw.accessories || "", 4000);
    let tags = cleanText(raw.tags || "", 4000);
    if (tags && !appearance && !attire && !accessories) {
      [appearance, attire, accessories] = splitLookTags(tags);
    } else if (tags) {
      const [id, clothes, acc] = splitLookTags(joinTags(appearance, tags));
      appearance = id;
      attire = joinTags(attire, clothes);
      accessories = joinTags(accessories, acc);
    }
    // Keep appearance identity-only; spill clothes/accessories into their fields.
    if (appearance) {
      const [id, clothes, acc] = splitLookTags(appearance);
      appearance = id;
      attire = joinTags(attire, clothes);
      accessories = joinTags(accessories, acc);
    }
    if (original && appearance) {
      appearance = joinTags(...appearance.split(",").filter((t) => normalizeAlias(t) !== normalizeAlias(original)));
    }
    let cid = cleanText(raw.id, 80) || name.replace(/[^a-zA-Z0-9_\uac00-\ud7a3]+/g, "_").replace(/^_|_$/g, "").slice(0, 64);
    if (!cid) cid = `char_${Math.abs(hashCode(name)) % 10000000}`;
    const migrated = globalThis.__INLAY_IDENTITY__?.migrateCharacter?.({
      ...raw,
      id: cid,
      name,
      aliases,
      original,
      appearance,
      attire,
      accessories,
    });
    return migrated || {
      id: cid,
      name,
      aliases,
      original,
      appearance,
      attire,
      accessories,
      surname: cleanText(raw.surname || "", 200),
      given_name: cleanText(raw.given_name || "", 200),
      surname_variants: parseAliasList(raw.surname_variants),
      given_name_variants: parseAliasList(raw.given_name_variants),
      priority: Number(raw.priority || 0),
      attire_locked: raw.attire_locked === true,
      accessories_locked: raw.accessories_locked === true,
      schema_version: 2,
    };
  }

  function hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return h;
  }

  /** Persist enough message body for streaming prefix re-link (≥50%). */
  const ASSISTANT_PREVIEW_LIMIT = 4000;

  /** Same session-id fingerprint as vendor `ye()` — used for risu_${hash(char|chat)}. */
  function sessionIdHash(raw) {
    const n = cleanText(raw, 1e6);
    let o = 2166136261;
    let a = 2654435769;
    for (let r = 0; r < n.length; r += 1) {
      const i = n.charCodeAt(r);
      o ^= i;
      o = Math.imul(o, 16777619);
      a ^= i + ((o << 6) | (o >>> 26));
      a = Math.imul(a, 2246822507);
    }
    return `${(o >>> 0).toString(16).padStart(8, "0")}${(a >>> 0).toString(16).padStart(8, "0")}`;
  }

  function unifiedSessionIdForCharacter(characterId) {
    const id = cleanText(characterId || "", 200);
    if (!id) return "";
    return `risu_${sessionIdHash(`${id}|__unified__`)}`;
  }

  function characterMaxLimit(card) {
    card = typeof card === "object" && card ? card : {};
    let n = parseInt(card.character_max ?? card.char_max ?? 6, 10);
    if (Number.isNaN(n)) n = 6;
    return Math.max(1, Math.min(6, n));
  }

  function stripCbs(text) {
    let out = text;
    for (let i = 0; i < 20; i++) {
      const nxt = out
        .replace(/\{\{#when[\s\S]*?\}\}([\s\S]*?)\{\{\/when\}\}/g, "$1")
        .replace(/\{\{#if[\s\S]*?\}\}([\s\S]*?)\{\{\/if\}\}/g, "$1")
        .replace(/\{\{:else\}\}[\s\S]*?(?=\{\{\/)/g, "");
      if (nxt === out) break;
      out = nxt;
    }
    return out.replace(/\{\{[^}]+\}\}/g, "").trim();
  }

  function extractPreset(content) {
    const positive = content.match(/\[Positive\]\s*([\s\S]*?)\s*\[Negative\]/);
    const negative = content.match(/\[Negative\]\s*([\s\S]*?)\s*$/);
    if (positive || negative) {
      return [cleanText(positive?.[1] || ""), cleanText(negative?.[1] || "")];
    }
    return [cleanText(content), ""];
  }

  function parseJsonLoose(text) {
    let raw = cleanText(text);
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const preview = raw.slice(0, 180).replace(/\s+/g, " ");
    try {
      return JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error(`태거 JSON 파싱 실패${preview ? ` · 응답: ${preview}` : " · 응답이 비어 있거나 JSON이 아님"}`);
      }
      try {
        return JSON.parse(match[0]);
      } catch (err) {
        throw new Error(`태거 JSON 파싱 실패 · ${String(err?.message || err).slice(0, 120)} · 응답: ${preview}`);
      }
    }
  }

  function modelToNaia(model) {
    model = cleanText(model) || "nai-diffusion-4-5-full";
    const reverse = Object.fromEntries(Object.entries(MODELS).map(([k, v]) => [v, k]));
    if (MODELS[model]) return model;
    if (reverse[model]) return reverse[model];
    return "naid4.5f";
  }

  function bytesToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /** Yielding base64 — avoids freezing the plugin iframe on multi-MB PNGs. */
  async function bytesToBase64Async(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < 200_000) return bytesToBase64(u8);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
      if (i > 0 && i % (chunk * 24) === 0) await sleep(0);
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function u8ToArrayBuffer(u8) {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  function isPngBytes(u8) {
    return (
      u8 &&
      u8.length >= 8 &&
      u8[0] === 0x89 &&
      u8[1] === 0x50 &&
      u8[2] === 0x4e &&
      u8[3] === 0x47
    );
  }

  function isWebpBytes(u8) {
    return (
      u8 &&
      u8.length >= 12 &&
      u8[0] === 0x52 &&
      u8[1] === 0x49 &&
      u8[2] === 0x46 &&
      u8[3] === 0x46 &&
      u8[8] === 0x57 &&
      u8[9] === 0x45 &&
      u8[10] === 0x42 &&
      u8[11] === 0x50
    );
  }

  function asU8(buf) {
    if (!buf) return new Uint8Array(0);
    if (buf instanceof Uint8Array) return buf;
    return new Uint8Array(buf);
  }

  function sniffImageMime(buf) {
    const u8 = asU8(buf);
    if (isWebpBytes(u8)) return "image/webp";
    if (isPngBytes(u8)) return "image/png";
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "image/jpeg";
    return "image/png";
  }

  function dataUrlToArrayBuffer(dataUrl) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(String(dataUrl || ""));
    if (!m) return null;
    const isB64 = Boolean(m[2]);
    const payload = m[3] || "";
    try {
      if (isB64) return u8ToArrayBuffer(base64ToBytes(payload));
      return u8ToArrayBuffer(new TextEncoder().encode(decodeURIComponent(payload)));
    } catch {
      return null;
    }
  }

  /** Re-encode gallery images to WebP @ 0.8 for smaller IndexedDB + data: URLs. Falls back to original. */
  async function encodeWebpQuality(buf, quality = 0.8) {
    const src = asU8(buf);
    if (!src.length) return null;
    if (isWebpBytes(src)) return u8ToArrayBuffer(src);
    const mime = sniffImageMime(src);
    try {
      const blob = new Blob([src], { type: mime });
      let bitmap = null;
      if (typeof createImageBitmap === "function") {
        bitmap = await createImageBitmap(blob);
      } else if (typeof document !== "undefined") {
        bitmap = await new Promise((resolve, reject) => {
          const img = new Image();
          const objUrl = URL.createObjectURL(blob);
          img.onload = () => {
            URL.revokeObjectURL(objUrl);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objUrl);
            reject(new Error("image decode failed"));
          };
          img.src = objUrl;
        });
      } else {
        return null;
      }
      const w = bitmap.width || bitmap.naturalWidth || 0;
      const h = bitmap.height || bitmap.naturalHeight || 0;
      if (!(w > 0 && h > 0)) {
        try {
          bitmap.close?.();
        } catch {
        }
        return null;
      }
      let outBlob = null;
      if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0);
        outBlob = await canvas.convertToBlob({ type: "image/webp", quality });
      } else if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0);
        const dataUrl = canvas.toDataURL("image/webp", quality);
        const ab = dataUrlToArrayBuffer(dataUrl);
        try {
          bitmap.close?.();
        } catch {
        }
        if (!ab || !isWebpBytes(asU8(ab))) return null;
        if (asU8(ab).length >= src.length * 0.98) return null;
        return ab;
      }
      try {
        bitmap.close?.();
      } catch {
      }
      if (!outBlob || !outBlob.size) return null;
      const ab = await outBlob.arrayBuffer();
      if (!isWebpBytes(asU8(ab))) return null;
      // Keep original if WebP somehow larger (rare).
      if (asU8(ab).length >= src.length * 0.98) return null;
      return ab;
    } catch (err) {
      dbg("image.webp.encode.fail", { message: String(err?.message || err) }, "warn");
      return null;
    }
  }

  function readU16LE(u8, o) {
    return u8[o] | (u8[o + 1] << 8);
  }
  function readU32LE(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  }

  function findZipEocdOffset(u8) {
    const start = Math.max(0, u8.length - 65536 - 22);
    for (let i = u8.length - 22; i >= start; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
        const commentLen = readU16LE(u8, i + 20);
        if (i + 22 + commentLen <= u8.length) return i;
      }
    }
    return -1;
  }

  /** Prefer central-directory sizes — local header often has bit3/zero sizes and our old scan fed CD bytes into inflate (hang). */
  function zipEntryFromCentralDir(u8) {
    const eocd = findZipEocdOffset(u8);
    if (eocd < 0) return null;
    const cdOffset = readU32LE(u8, eocd + 16);
    if (cdOffset + 46 > u8.length) return null;
    if (u8[cdOffset] !== 0x50 || u8[cdOffset + 1] !== 0x4b || u8[cdOffset + 2] !== 0x01 || u8[cdOffset + 3] !== 0x02) {
      return null;
    }
    const compMethod = readU16LE(u8, cdOffset + 10);
    const compSize = readU32LE(u8, cdOffset + 20);
    const uncompSize = readU32LE(u8, cdOffset + 24);
    const localOffset = readU32LE(u8, cdOffset + 42);
    if (localOffset + 30 > u8.length) return null;
    if (u8[localOffset] !== 0x50 || u8[localOffset + 1] !== 0x4b || u8[localOffset + 2] !== 0x03 || u8[localOffset + 3] !== 0x04) {
      return null;
    }
    const localNameLen = readU16LE(u8, localOffset + 26);
    const localExtraLen = readU16LE(u8, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > u8.length) return null;
    return {
      source: "central_dir",
      compMethod,
      compSize,
      uncompSize,
      dataStart,
      compData: u8.subarray(dataStart, dataStart + compSize),
    };
  }

  function zipEntryFromLocalHeader(u8) {
    const gpFlag = readU16LE(u8, 6);
    const compMethod = readU16LE(u8, 8);
    let compSize = readU32LE(u8, 18);
    const nameLen = readU16LE(u8, 26);
    const extraLen = readU16LE(u8, 28);
    const dataStart = 30 + nameLen + extraLen;
    if ((gpFlag & 0x08) !== 0 || compSize === 0) {
      // End of payload = start of data descriptor / central dir / EOCD — never use file EOF.
      let end = -1;
      for (let i = dataStart + 4; i < u8.length - 3; i++) {
        if (u8[i] !== 0x50 || u8[i + 1] !== 0x4b) continue;
        const sig = u8[i + 2];
        if (sig === 0x07 || sig === 0x01 || sig === 0x05) {
          end = i;
          break;
        }
      }
      if (end < 0) {
        const eocd = findZipEocdOffset(u8);
        if (eocd > dataStart) end = eocd;
      }
      if (end < 0) throw new Error("ZIP 데이터 경계를 찾지 못했습니다 (local header bit3)");
      compSize = end - dataStart;
    }
    if (dataStart + compSize > u8.length) {
      throw new Error(`ZIP 엔트리 길이 초과 (need ${dataStart + compSize}, have ${u8.length})`);
    }
    return {
      source: "local_header",
      compMethod,
      compSize,
      uncompSize: readU32LE(u8, 22),
      dataStart,
      compData: u8.subarray(dataStart, dataStart + compSize),
    };
  }

  async function inflateRaw(compData) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("DecompressionStream 미지원 — ZIP deflate를 풀 수 없습니다");
    }
    const u8 = compData instanceof Uint8Array ? compData : new Uint8Array(compData);
    dbg("nai.inflate.start", { message: `${u8.length}B`, bytes: u8.length, focus: true });
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const outChunks = [];
    let outTotal = 0;
    const deadline = Date.now() + 20000;

    const readerTask = (async () => {
      while (true) {
        if (Date.now() >= deadline) throw new Error(`ZIP inflate 타임아웃 (out=${outTotal}B)`);
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        outChunks.push(value);
        outTotal += value.length;
        if (outTotal > 0 && outTotal % (512 * 1024) < value.length) {
          dbg("nai.inflate", { message: `out ${Math.round(outTotal / 1024)}KB`, bytes: outTotal, focus: true });
        }
        // PNG complete?
        if (outTotal >= 12) {
          const head = outChunks[0];
          if (head && head[0] === 0x89 && head[1] === 0x50) {
            // look for IEND in last chunk
            const last = outChunks[outChunks.length - 1];
            for (let i = 0; i + 7 < last.length; i++) {
              if (last[i] === 0x49 && last[i + 1] === 0x45 && last[i + 2] === 0x4e && last[i + 3] === 0x44) {
                // allow reader to finish naturally; IEND means we're basically done
              }
            }
          }
        }
      }
    })();

    const slice = 128 * 1024;
    for (let i = 0; i < u8.length; i += slice) {
      if (Date.now() >= deadline) {
        try {
          await writer.abort();
        } catch (_) {}
        throw new Error(`ZIP inflate write 타임아웃 (in=${i}B)`);
      }
      await writer.write(u8.subarray(i, Math.min(u8.length, i + slice)));
      if (i > 0 && i % (slice * 4) === 0) await sleep(0);
    }
    await writer.close();
    await readerTask;

    const out = new Uint8Array(outTotal);
    let pos = 0;
    for (const c of outChunks) {
      out.set(c, pos);
      pos += c.length;
    }
    dbg("nai.inflate.done", { bytes: outTotal, focus: true });
    return out;
  }

  async function unzipFirstEntry(content) {
    const u8 = content instanceof Uint8Array ? content : new Uint8Array(content);
    dbg("nai.unzip.start", { message: `${u8.length}B`, bytes: u8.length, focus: true });
    if (isPngBytes(u8)) {
      dbg("nai.unzip", { message: "raw PNG", bytes: u8.length, focus: true });
      return u8ToArrayBuffer(u8);
    }
    if (u8.length < 30 || u8[0] !== 0x50 || u8[1] !== 0x4b) {
      const head = Array.from(u8.subarray(0, 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      throw new Error(`ZIP/PNG 응답이 아닙니다 (len=${u8.length}, head=${head})`);
    }

    let entry = zipEntryFromCentralDir(u8);
    if (!entry) entry = zipEntryFromLocalHeader(u8);

    dbg("nai.unzip.entry", {
      message: `${entry.source} method=${entry.compMethod} comp=${entry.compSize}B uncomp=${entry.uncompSize || "?"}`,
      comp_method: entry.compMethod,
      bytes: entry.compSize,
      source: entry.source,
      focus: true,
    });

    // If local-header scan overshot into central dir / EOCD, clamp.
    const eocdAt = findZipEocdOffset(u8);
    if (eocdAt >= 0 && entry.dataStart + entry.compSize > eocdAt) {
      dbg("nai.unzip.clamp", {
        message: `comp ${entry.compSize} → ${eocdAt - entry.dataStart}`,
        focus: true,
      }, "warn");
      entry.compSize = eocdAt - entry.dataStart;
      entry.compData = u8.subarray(entry.dataStart, eocdAt);
    }
    if (entry.compSize <= 0) throw new Error("ZIP 압축 페이로드가 비어 있습니다");

    if (entry.compMethod === 0) {
      if (isPngBytes(entry.compData)) return u8ToArrayBuffer(entry.compData);
      return u8ToArrayBuffer(entry.compData);
    }
    if (entry.compMethod === 8) {
      const inflated = await inflateRaw(entry.compData);
      if (!isPngBytes(inflated) && !(inflated[0] === 0x52 && inflated[1] === 0x49)) {
        // RIFF/webp also possible
        dbg("nai.unzip", { message: "inflated but not PNG/RIFF magic", bytes: inflated.length }, "warn");
      }
      return u8ToArrayBuffer(inflated);
    }
    throw new Error(`지원하지 않는 ZIP 압축 방식: ${entry.compMethod}`);
  }

  function resolveModel(key, isInpaint = false) {
    let name = MODELS[String(key).toLowerCase()] || key;
    if (isInpaint) name += "-inpainting";
    return name;
  }

  function buildV4Prompt(req) {
    const charCaptions = [];
    const negCharCaptions = [];
    for (const c of req.characters || []) {
      const center = { x: c.center_x, y: c.center_y };
      charCaptions.push({ char_caption: c.prompt, centers: [center] });
      negCharCaptions.push({ char_caption: c.uc || "", centers: [center] });
    }
    return {
      autoSmea: true,
      prefer_brownian: true,
      ucPreset: 0,
      use_coords: false,
      legacy_uc: false,
      add_original_image: true,
      v4_prompt: {
        caption: { base_caption: req.prompt, char_captions: charCaptions },
        use_coords: false,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: { base_caption: req.negative_prompt, char_captions: negCharCaptions },
        legacy_uc: false,
      },
    };
  }

  function buildBaseParameters(req) {
    const modelName = resolveModel(req.model);
    const params = {
      width: req.width,
      height: req.height,
      n_samples: 1,
      seed: req.seed,
      extra_noise_seed: req.seed,
      sampler: req.sampler,
      steps: req.steps,
      scale: req.cfg_scale,
      negative_prompt: req.negative_prompt,
      cfg_rescale: req.cfg_rescale,
      noise_schedule: req.scheduler,
      params_version: 3,
      legacy: false,
      legacy_v3_extend: false,
    };
    if (req.var_plus) params.skip_cfg_above_sigma = modelName.includes("4-5") ? 58 : 19;
    else params.skip_cfg_above_sigma = null;
    if (modelName.includes("nai-diffusion-4")) Object.assign(params, buildV4Prompt(req));
    if (req.vibes?.length) {
      params.reference_image_multiple = req.vibes.map((v) => v.encoded);
      params.reference_strength_multiple = req.vibes.map((v) => v.strength);
      params.reference_information_extracted_multiple = req.vibes.map((v) => v.information_extracted);
      params.normalize_reference_strength_multiple = true;
    }
    if (req.character_refs?.length) {
      if (!modelName.includes("4-5")) throw new Error("Character Reference는 NAID4.5 전용입니다");
      params.director_reference_images = req.character_refs.map((r) => bytesToBase64(r.image));
      params.director_reference_strength_values = req.character_refs.map((r) => r.strength);
      params.director_reference_secondary_strength_values = req.character_refs.map((r) => 1.0 - r.fidelity);
      params.director_reference_descriptions = req.character_refs.map((r) => ({
        caption: { base_caption: r.type, char_captions: [] },
        legacy_uc: false,
      }));
      params.director_reference_information_extracted = req.character_refs.map(() => 1.0);
      params.controlnet_strength = 1.0;
      params.inpaintImg2ImgStrength = 1.0;
      params.normalize_reference_strength_multiple = true;
      delete params.skip_cfg_above_sigma;
    }
    return params;
  }

  async function encodeVibe(token, imageBytes, model, informationExtracted = 1.0, maxRetries = 3) {
    const modelName = resolveModel(model);
    const ie = Math.max(0, Math.min(1, Number(informationExtracted) || 1.0));
    const payload = {
      image: await bytesToBase64Async(imageBytes),
      information_extracted: ie,
      model: modelName,
    };
    let lastError = "";
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        dbg("nai.encode_vibe.start", { message: modelName, ie, attempt, focus: true });
        const resp = await networkFetch(ENCODE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const status = Number(resp?.status || 0);
        if ([502, 503, 504, 520].includes(status)) {
          lastError = `HTTP ${status}`;
          await sleep(2 * attempt * 1000);
          continue;
        }
        if (status < 200 || status >= 300) {
          let detail = "";
          try {
            detail = typeof resp?.text === "function" ? await resp.text() : "";
          } catch (_) {}
          lastError = `HTTP ${status}: ${String(detail).slice(0, 200)}`;
          if (attempt < maxRetries) {
            await sleep(1000);
            continue;
          }
          break;
        }
        const bytes = await readResponseBytes(resp, { timeoutMs: 60000 });
        const encoded = await bytesToBase64Async(bytes);
        dbg("nai.encode_vibe.done", { message: modelName, bytes: bytes?.byteLength || bytes?.length || 0, focus: true });
        return encoded;
      } catch (err) {
        lastError = String(err?.message || err);
        if (attempt < maxRetries) {
          await sleep(1000);
          continue;
        }
      }
    }
    throw new Error(`encode-vibe 실패 (${maxRetries}회): ${lastError}`);
  }

  async function networkFetch(url, options = {}) {
    const nf = globalThis.risuai?.nativeFetch || globalThis.fetch;
    const via = globalThis.risuai?.nativeFetch ? "nativeFetch" : "fetch";
    if (typeof nf !== "function") throw new Error("fetch를 사용할 수 없습니다");
    const opts = { ...options };
    if (opts.networkRoute == null) delete opts.networkRoute;
    const span = dbgSpan("net.fetch");
    dbg("net.fetch.start", { message: via, url: String(url).slice(0, 120), has_signal: Boolean(opts.signal) });
    try {
      const resp = await nf(url, opts);
      const status = Number(resp?.status || (resp?.ok === false ? 0 : 200));
      span.end({ message: via, status, url: String(url).slice(0, 80) });
      return resp;
    } catch (err) {
      span.fail(err, { message: via, url: String(url).slice(0, 80) });
      throw err;
    }
  }

  async function readResponseBytes(resp, opts = {}) {
    if (!resp) throw new Error("빈 응답");
    const deadline = Number(opts.deadline || Date.now() + Number(opts.timeoutMs || 90000));
    const signal = opts.signal || null;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const idleMs = Number(opts.idleMs || 2500);

    const throwIfTimedOut = (got = 0) => {
      if (signal?.aborted) throw new Error(`NAI 본문 읽기 중단 (abort, ${got}B)`);
      if (Date.now() >= deadline) throw new Error(`NAI 본문 읽기 타임아웃 (${got}B received)`);
    };

    // Already-bytes shapes (risuFetch rawResponse / some polyfills)
    if (resp instanceof ArrayBuffer) return resp;
    if (resp instanceof Uint8Array) return u8ToArrayBuffer(resp);
    if (typeof resp === "string") {
      const s = resp.replace(/\s+/g, "");
      if (s.length > 64 && /^[A-Za-z0-9+/=]+$/.test(s)) {
        dbg("nai.read_bytes", { message: "string base64 body", bytes: s.length, focus: true });
        return u8ToArrayBuffer(base64ToBytes(s));
      }
    }
    if (resp?.buffer instanceof ArrayBuffer && typeof resp.byteLength === "number") {
      return resp.buffer.slice(resp.byteOffset || 0, (resp.byteOffset || 0) + resp.byteLength);
    }
    if (resp && typeof resp === "object" && "data" in resp && !resp.arrayBuffer && !resp.body) {
      return readResponseBytes(resp.data, opts);
    }

    let contentLen = null;
    try {
      const h = resp.headers;
      const raw = h?.get?.("content-length") || h?.get?.("Content-Length") || null;
      if (raw) contentLen = Number(raw);
    } catch (_) {}
    // Expected size for UI (not counted as received until chunks arrive).
    if (contentLen > 0) naiBodyBytesExpected = contentLen;
    dbg("nai.read_bytes.start", {
      message: "begin body",
      content_length: contentLen,
      has_arrayBuffer: typeof resp.arrayBuffer === "function",
      has_body_reader: Boolean(resp.body && typeof resp.body.getReader === "function"),
      keys: resp && typeof resp === "object" ? Object.keys(resp).slice(0, 12).join(",") : typeof resp,
      focus: true,
    });

    // Prefer streaming — finish early when Content-Length / ZIP EOCD satisfied (Risu often never sends done).
    if (resp.body && typeof resp.body.getReader === "function") {
      const reader = resp.body.getReader();
      const chunks = [];
      let total = 0;
      let lastChunkAt = Date.now();
      let lastLog = Date.now();
      let forceFinish = false;
      let settleRead = null;

      naiBodyControl = {
        forceFinish: (reason = "force") => {
          forceFinish = true;
          dbg("nai.read_bytes.force", { message: reason, bytes: total || contentLen || 0, focus: true });
          try {
            reader.cancel();
          } catch (_) {}
          if (settleRead) settleRead({ done: true, value: undefined, __forced: true });
        },
      };

      try {
        while (true) {
          throwIfTimedOut(total);
          if (forceFinish) break;
          // Idle with enough bytes → treat as complete (done:true often never arrives).
          if (total >= 64 && Date.now() - lastChunkAt >= idleMs) {
            dbg("nai.read_bytes.idle_complete", { message: `${idleMs}ms idle`, bytes: total, focus: true });
            break;
          }
          if (contentLen > 0 && total >= contentLen) {
            dbg("nai.read_bytes.length_complete", { bytes: total, content_length: contentLen, focus: true });
            break;
          }

          const packet = await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (v, err) => {
              if (settled) return;
              settled = true;
              clearInterval(iv);
              settleRead = null;
              if (err) reject(err);
              else resolve(v);
            };
            settleRead = (v) => finish(v, null);
            const iv = setInterval(() => {
              if (settled) return;
              if (forceFinish) return finish({ done: true, value: undefined, __forced: true });
              if (total >= 64 && Date.now() - lastChunkAt >= idleMs) {
                return finish({ done: true, value: undefined, __idle: true });
              }
              if (contentLen > 0 && total >= contentLen) {
                return finish({ done: true, value: undefined, __length: true });
              }
              if (signal?.aborted || Date.now() >= deadline) {
                reader.cancel().catch(() => {});
                return finish(null, new Error(`NAI 본문 읽기 타임아웃 (${total}B received)`));
              }
            }, 200);
            reader.read().then(
              (r) => finish(r, null),
              (err) => finish(null, err),
            );
          });

          if (packet?.__forced || packet?.__idle || packet?.__length) break;
          const { done, value } = packet;
          if (done) break;
          if (!value) continue;
          const part = value instanceof Uint8Array ? value : new Uint8Array(value);
          chunks.push(part);
          total += part.length;
          lastChunkAt = Date.now();
          naiLastByteAt = lastChunkAt;
          naiBodyBytesReceived = total;
          if (onProgress) onProgress(total, contentLen);
          if (Date.now() - lastLog >= 2000) {
            lastLog = Date.now();
            dbg("nai.read_bytes.progress", {
              message: `${Math.round(total / 1024)}KB`,
              bytes: total,
              content_length: contentLen,
              focus: true,
            });
          }
          // Early exit only after brief idle — EOCD alone can false-positive mid-stream.
          if (zipHasEocd(concatChunks(chunks, total)) && Date.now() - lastChunkAt >= 600) {
            dbg("nai.read_bytes.zip_eocd", { bytes: total, focus: true });
            break;
          }
          if (contentLen > 0 && total >= contentLen) break;
        }
      } catch (err) {
        // If we already have a full ZIP, prefer success over throw.
        if (total >= 64) {
          const maybe = concatChunks(chunks, total);
          if (zipHasEocd(maybe) || (contentLen > 0 && total >= contentLen * 0.98)) {
            dbg("nai.read_bytes.recover", { message: String(err?.message || err), bytes: total, focus: true }, "warn");
            naiBodyControl = null;
            return u8ToArrayBuffer(maybe);
          }
        }
        try {
          await reader.cancel();
        } catch (_) {}
        naiBodyControl = null;
        throw err;
      }
      naiBodyControl = null;
      if (!total) throw new Error("NAI 본문이 비어 있습니다");
      const out = concatChunks(chunks, total);
      dbg("nai.read_bytes.done", { bytes: total, focus: true });
      return u8ToArrayBuffer(out);
    }

    if (typeof resp.arrayBuffer === "function") {
      dbg("nai.read_bytes", { message: "fallback arrayBuffer() — no body stream", focus: true });
      let settled = false;
      let resolveBuf;
      let rejectBuf;
      const bufPromise = new Promise((resolve, reject) => {
        resolveBuf = resolve;
        rejectBuf = reject;
      });
      naiBodyControl = {
        forceFinish: (reason = "force") => {
          // Cannot extract partial arrayBuffer — abort so job errors instead of hanging forever.
          dbg("nai.read_bytes.force", { message: `${reason} (arrayBuffer)`, content_length: contentLen, focus: true }, "warn");
          if (!settled) {
            settled = true;
            rejectBuf(new Error(`NAI arrayBuffer 강제중단 (${reason}, content-length=${contentLen})`));
          }
        },
      };
      const iv = setInterval(() => {
        if (settled) return;
        if (signal?.aborted || Date.now() >= deadline) {
          settled = true;
          clearInterval(iv);
          naiBodyControl = null;
          rejectBuf(
            new Error(
              `NAI arrayBuffer 타임아웃 (content-length=${contentLen}). 본문 ~${contentLen ? Math.round(contentLen / 1024) : "?"}KB를 플러그인이 받지 못했습니다.`,
            ),
          );
        } else {
          dbg("nai.read_bytes.wait", {
            message: `arrayBuffer pending · expect ${contentLen ? Math.round(contentLen / 1024) : "?"}KB`,
            content_length: contentLen,
            focus: true,
          }, "warn");
        }
      }, 3000);
      resp
        .arrayBuffer()
        .then((b) => {
          if (settled) return;
          settled = true;
          clearInterval(iv);
          naiBodyControl = null;
          resolveBuf(b);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          clearInterval(iv);
          naiBodyControl = null;
          rejectBuf(err);
        });
      const buf = await bufPromise;
      if (buf && buf.byteLength) {
        naiBodyBytesReceived = buf.byteLength;
        dbg("nai.read_bytes.done", { bytes: buf.byteLength, focus: true });
        return buf;
      }
    }
    if (typeof resp.bytes === "function") {
      const u8 = await resp.bytes();
      if (u8?.length) return u8ToArrayBuffer(u8);
    }
    if (typeof resp.text === "function") {
      const text = await resp.text();
      if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s+/g, "").length > 64) {
        try {
          return u8ToArrayBuffer(base64ToBytes(text.replace(/\s+/g, "")));
        } catch (_) {}
      }
      throw new Error(`바이너리 본문을 읽지 못함 (text head=${String(text).slice(0, 120)})`);
    }
    throw new Error("바이너리 본문을 읽지 못함");
  }

  async function withTimeout(promise, ms, label) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} 타임아웃 (${Math.round(ms / 1000)}s)`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function naiPost(token, payload, apiUrl, opts = {}) {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const timeoutMs = Number(opts.timeoutMs || 75000);
    const externalSignal = opts.signal || null;
    const bodyStr = JSON.stringify(payload);
    dbg("nai.payload", {
      message: `body ${Math.round(bodyStr.length / 1024)}KB`,
      bytes: bodyStr.length,
      model: payload?.model,
      timeout_ms: timeoutMs,
      url: String(apiUrl || API_URL).slice(0, 100),
      has_nativeFetch: typeof globalThis.risuai?.nativeFetch === "function",
    });
    if (bodyStr.length > 1_500_000) {
      dbg("nai.payload", { message: "too large", bytes: bodyStr.length }, "error");
      throw new Error(`NAI 페이로드가 너무 큼 (${Math.round(bodyStr.length / 1024)}KB). 참조 이미지/프롬프트를 줄이세요.`);
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const onExternalAbort = () => {
      dbg("nai.abort", { message: "external signal" }, "warn");
      controller?.abort?.();
    };
    if (externalSignal) {
      if (externalSignal.aborted) throw new Error("NAI 요청이 취소되었습니다.");
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    // Wall-clock abort — plugin iframe setTimeout is heavily throttled when hidden.
    const started = Date.now();
    naiBodyBytesReceived = 0;
    naiBodyBytesExpected = 0;
    naiLastByteAt = 0;
    pauseDiskPersist = true;
    const watchdog = setInterval(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) {
        dbg("nai.watchdog", { message: `abort after ${elapsed}ms · body=${naiBodyBytesReceived}B`, ms: elapsed, bytes: naiBodyBytesReceived }, "warn");
        controller?.abort?.();
      } else if (elapsed > 0 && elapsed % 10000 < 1100) {
        dbg("nai.wait", {
          message: `waiting ${Math.round(elapsed / 1000)}s · body=${naiBodyBytesReceived}B · ${debugFocusStage}`,
          ms: elapsed,
          bytes: naiBodyBytesReceived,
          focus: true,
        }, "warn");
      }
    }, 1000);

    let lastError = null;
    try {
      try {
        dbg("nai.fetch.start", { message: "POST generate-image", timeout_ms: timeoutMs, focus: true });
        const resp = await networkFetch(apiUrl || API_URL, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: controller?.signal,
          requestTimeoutMs: timeoutMs,
        });
        dbg("nai.fetch.returned", { message: "nativeFetch resolved", ms: Date.now() - started, status: Number(resp?.status || 0), focus: true });

        if (externalSignal?.aborted || controller?.signal?.aborted) {
          dbg("nai.fetch.aborted", { ms: Date.now() - started }, "error");
          throw new Error(`NAI 타임아웃 (${Math.round(timeoutMs / 1000)}s) — nativeFetch가 응답하지 않습니다. Models에서 NAI Test를 확인하세요.`);
        }

        const readOpts = {
          signal: controller?.signal,
          deadline: started + timeoutMs,
          onProgress: (got) => {
            naiBodyBytesReceived = got;
          },
        };

        // globalFetch-like shape
        if (resp && typeof resp === "object" && "ok" in resp && "data" in resp && !resp.arrayBuffer) {
          const status = Number(resp.status || (resp.ok ? 200 : 0));
          dbg("nai.resp.shape", { message: "ok/data shape", status, focus: true });
          if (status === 401) throw new Error("인증 실패 (401). NovelAI API 토큰(pst-...)을 확인하세요.");
          if (status === 429) throw new Error("Rate limited (429). 잠시 후 다시 시도하세요.");
          if (status >= 400) {
            const detail =
              typeof resp.data === "string"
                ? resp.data
                : resp.data instanceof Uint8Array
                  ? new TextDecoder().decode(resp.data.subarray(0, 220))
                  : JSON.stringify(resp.data || {}).slice(0, 220);
            throw new Error(`NAI HTTP ${status}: ${detail}`);
          }
          const spanRead = dbgSpan("nai.read_bytes");
          const buf = await readResponseBytes(resp.data, readOpts);
          spanRead.end({ bytes: buf?.byteLength || 0, focus: true });
          if (!buf || buf.byteLength < 32) throw new Error(`NAI 응답이 너무 짧음 (${buf?.byteLength || 0} bytes)`);
          return buf;
        }

        const status = Number(resp?.status || 0);
        dbg("nai.resp.shape", {
          message: "Response-like",
          status,
          has_arrayBuffer: typeof resp?.arrayBuffer === "function",
          has_body: Boolean(resp?.body),
          focus: true,
        });
        if (status === 401) throw new Error("인증 실패 (401). NovelAI API 토큰(pst-...)을 확인하세요.");
        if (status === 429) throw new Error("Rate limited (429). 잠시 후 다시 시도하세요.");
        if (status >= 400) {
          let detail = "";
          try {
            detail = await resp.text();
          } catch (_) {}
          throw new Error(`NAI HTTP ${status}: ${detail.slice(0, 220)}`);
        }
        const spanRead = dbgSpan("nai.read_bytes");
        const buf = await readResponseBytes(resp, readOpts);
        spanRead.end({ bytes: buf?.byteLength || 0, status, focus: true });
        if (!buf || buf.byteLength < 32) throw new Error(`NAI 응답이 너무 짧음 (${buf?.byteLength || 0} bytes)`);
        return buf;
      } catch (err) {
        lastError = String(err?.message || err);
        dbg("nai.fetch.error", { message: lastError, ms: Date.now() - started, bytes: naiBodyBytesReceived }, "error");
        if (/abort|timeout|타임아웃|취소|본문 읽기/i.test(lastError)) {
          throw new Error(
            `NAI 타임아웃/본문실패 (${Math.round(timeoutMs / 1000)}s, body=${naiBodyBytesReceived}B). ${lastError.slice(0, 180)}`,
          );
        }
        throw err instanceof Error ? err : new Error(lastError);
      }
    } finally {
      pauseDiskPersist = false;
      clearInterval(watchdog);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }

  async function withGenerateMutex(fn) {
    const prev = generateMutex;
    let release;
    generateMutex = new Promise((r) => {
      release = r;
    });
    // Don't await prev with setTimeout — iframe timers throttle. Steal after checking age via Promise.race with 1s polls.
    const stealAt = Date.now() + 8000;
    while (true) {
      let settled = false;
      await Promise.race([
        Promise.resolve(prev).then(() => {
          settled = true;
        }),
        sleep(1000),
      ]);
      if (settled) break;
      if (Date.now() >= stealAt) {
        console.warn("[Inlay Nexus] NAI mutex steal");
        break;
      }
    }
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /* ── ComfyUI local API (POST /prompt → GET /history → GET /view) ───────── */

  function imageBackendKind(nai) {
    const b = cleanText(nai?.backend || "nai").toLowerCase();
    return b === "comfy" ? "comfy" : "nai";
  }

  function backendTimeoutMs(nai) {
    const s = Number(nai?.backend_timeout_seconds ?? 300);
    return Math.max(30, Math.min(1800, Number.isNaN(s) ? 300 : s)) * 1000;
  }

  function trimBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function comfyBaseUrl(nai) {
    return trimBaseUrl(cleanText(nai?.comfy_url)) || "http://localhost:8188";
  }

  function comfyConfigured(nai) {
    return Boolean(cleanText(nai?.comfy_workflow_json));
  }

  /** networkFetch 응답 두 shape({ok,data} / Response-like) 공용 JSON 리더. */
  async function fetchJsonCompat(url, options = {}) {
    const resp = await networkFetch(url, options);
    if (resp && typeof resp === "object" && "ok" in resp && "data" in resp && typeof resp.arrayBuffer !== "function") {
      const status = Number(resp.status || (resp.ok ? 200 : 0));
      let data = resp.data;
      if (data instanceof Uint8Array) data = new TextDecoder().decode(data);
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch (_) {}
      }
      return { status, data };
    }
    const status = Number(resp?.status || 0);
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      try {
        data = JSON.parse(await resp.text());
      } catch (_) {}
    }
    return { status, data };
  }

  async function comfySubmitPrompt(baseUrl, promptData, opts = {}) {
    const clientId = `inlay-nexus-${Math.random().toString(36).slice(2, 10)}`;
    const { status, data } = await fetchJsonCompat(`${trimBaseUrl(baseUrl)}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, prompt: promptData }),
      signal: opts.signal,
    });
    if (status >= 400 || !data?.prompt_id) {
      const detail = data ? JSON.stringify(data.node_errors || data.error || data).slice(0, 300) : "";
      throw new Error(`/prompt 제출 실패 (HTTP ${status}) ${detail}`);
    }
    return String(data.prompt_id);
  }

  async function comfyWaitForImage(baseUrl, promptId, opts = {}) {
    const base = trimBaseUrl(baseUrl);
    const timeoutMs = Number(opts.timeoutMs || 300000);
    const deadline = Date.now() + timeoutMs;
    let polls = 0;
    let lastErr = "";
    while (Date.now() < deadline) {
      if (opts.signal?.aborted) throw new Error("이미지 대기 중단 (abort)");
      await sleep(2500);
      polls += 1;
      let entry = null;
      try {
        const { status, data } = await fetchJsonCompat(`${base}/history/${promptId}`, { method: "GET", signal: opts.signal });
        if (status < 400 && data && data[promptId]) entry = data[promptId];
      } catch (err) {
        lastErr = String(err?.message || err);
        continue;
      }
      if (polls % 8 === 0) {
        dbg("comfy.poll", {
          message: `${polls}회 · ${Math.round((Date.now() - (deadline - timeoutMs)) / 1000)}s`,
          focus: true,
        });
      }
      if (!entry) continue;
      const st = entry.status || {};
      if (st.status_str === "error") {
        throw new Error(`생성 실패: ${JSON.stringify(st.messages || []).slice(0, 400)}`);
      }
      const outputs = entry.outputs || {};
      for (const nodeId of Object.keys(outputs)) {
        const images = outputs[nodeId]?.images;
        if (Array.isArray(images) && images.length) {
          return images.find((im) => (im?.type || "output") !== "temp") || images[0];
        }
      }
      if (st.completed) throw new Error("생성은 완료됐지만 출력 이미지가 없습니다 (SaveImage 노드 확인)");
    }
    throw new Error(`이미지 대기 타임아웃 (${Math.round(timeoutMs / 1000)}s)${lastErr ? ` · ${lastErr}` : ""}`);
  }

  async function comfyFetchViewImage(baseUrl, ref, opts = {}) {
    const qs = new URLSearchParams({
      filename: cleanText(ref?.filename, 300),
      subfolder: cleanText(ref?.subfolder, 300),
      type: cleanText(ref?.type, 40) || "output",
    });
    const resp = await networkFetch(`${trimBaseUrl(baseUrl)}/view?${qs.toString()}`, { method: "GET", signal: opts.signal });
    const readOpts = { signal: opts.signal, deadline: Date.now() + 60000 };
    if (resp && typeof resp === "object" && "ok" in resp && "data" in resp && !resp.arrayBuffer) {
      const status = Number(resp.status || (resp.ok ? 200 : 0));
      if (status >= 400) throw new Error(`/view 실패 (HTTP ${status})`);
      return readResponseBytes(resp.data, readOpts);
    }
    const status = Number(resp?.status || 0);
    if (status >= 400) throw new Error(`/view 실패 (HTTP ${status})`);
    return readResponseBytes(resp, readOpts);
  }

  /** [[#name]]...[[/name]] — values[name]이 비어 있으면 블록 전체 삭제, 있으면 안쪽만 남김. */
  function applyComfyConditionalBlocks(text, values) {
    let out = String(text || "");
    // 같은 문자열에 여러 블록이 있을 수 있어, 한 번에 안 지워질 때까지 반복.
    for (let i = 0; i < 8; i += 1) {
      const next = out.replace(/\[\[#(\w+)\]\]([\s\S]*?)\[\[\/\1\]\]/g, (_, name, body) => {
        const v = values[name];
        const keep = v != null && String(v).trim() !== "";
        return keep ? body : "";
      });
      if (next === out) break;
      out = next;
    }
    // 빈 캐릭터 블록 제거 후 과도한 빈 줄 정리
    return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  }

  /** 워크플로 문자열의 [[name]] 플레이스홀더 치환. 값 전체가 [[name]]이면 타입 보존. */
  function substituteComfyPlaceholders(wf, values) {
    for (const node of Object.values(wf)) {
      const inputs = node?.inputs;
      if (!inputs || typeof inputs !== "object") continue;
      for (const key of Object.keys(inputs)) {
        const val = inputs[key];
        if (typeof val !== "string" || !val.includes("[[")) continue;
        let text = applyComfyConditionalBlocks(val, values);
        const exact = text.match(/^\[\[\s*(\w+)\s*\]\]$/);
        if (exact && exact[1] in values) {
          inputs[key] = values[exact[1]];
          continue;
        }
        inputs[key] = text.replace(/\[\[\s*(\w+)\s*\]\]/g, (m, name) => (name in values ? String(values[name]) : m));
      }
    }
  }

  /** API Export에 박힌 숫자 seed를 요청마다 새 시드로 덮어쓴다. ([[seed]] 치환 후에도 동일 값으로 맞춤) */
  function applyComfyRandomSeeds(wf, seed) {
    const s = Number(seed) || 1;
    for (const node of Object.values(wf)) {
      const inputs = node?.inputs;
      if (!inputs || typeof inputs !== "object") continue;
      for (const key of Object.keys(inputs)) {
        if (!/^(seed|noise_seed)$/i.test(key)) continue;
        const val = inputs[key];
        if (typeof val === "number" && Number.isFinite(val)) {
          inputs[key] = s;
        } else if (typeof val === "string" && /^\d+$/.test(val.trim())) {
          inputs[key] = s;
        }
      }
    }
  }

  function buildComfyPlaceholderValues({ main, neg, captions, nai, seed }) {
    const values = {
      pos: String(main || ""),
      neg: String(neg || ""),
      width: Number(nai.width ?? 832) || 832,
      height: Number(nai.height ?? 1216) || 1216,
      seed: Number(seed) || 1,
      steps: Number(nai.steps ?? 28) || 28,
      cfg: Number(nai.cfg_scale ?? 7) || 7,
    };
    for (let i = 0; i < 6; i += 1) {
      values[`char${i + 1}`] = cleanText(captions?.[i]?.prompt, 2000);
    }
    return values;
  }

  /**
   * `"seed": [[seed]]`처럼 따옴표 없이 쓴 플레이스홀더는 잘못된 JSON이므로
   * 파싱 전에 `"[[seed]]"` 문자열로 감싼다.
   */
  function normalizeComfyWorkflowJsonText(raw) {
    let text = String(raw || "");
    // 값 위치의 bare [[name]] → "[[name]]"
    text = text.replace(/(:\s*)\[\[\s*(\w+)\s*\]\](\s*[,}\]])/g, '$1"[[$2]]"$3');
    return text;
  }

  function buildComfyWorkflowFromTemplate(templateJson, values) {
    const custom = cleanText(templateJson);
    if (!custom) throw new Error("ComfyUI 워크플로 JSON이 비어 있습니다. Models 탭에 API Export JSON을 붙여넣으세요.");
    let wf;
    const normalized = normalizeComfyWorkflowJsonText(custom);
    try {
      wf = JSON.parse(normalized);
    } catch (err) {
      const tip = /\[\[/.test(custom)
        ? " · 팁: [[seed]] 같은 값은 반드시 \"[[seed]]\"처럼 따옴표로 감싸세요."
        : "";
      throw new Error(`ComfyUI 워크플로 JSON 파싱 실패: ${String(err?.message || err).slice(0, 120)}${tip}`);
    }
    if (!wf || typeof wf !== "object" || Array.isArray(wf)) {
      throw new Error("ComfyUI 워크플로는 API 포맷(JSON 객체, 노드ID→노드)이어야 합니다.");
    }
    if (wf.nodes && wf.links) {
      throw new Error("UI 저장 포맷 워크플로입니다. ComfyUI에서 'Export (API)'로 내보낸 JSON을 넣으세요.");
    }
    const raw = JSON.stringify(wf);
    if (!/\[\[\s*pos\s*\]\]/.test(raw)) {
      throw new Error("워크플로에 [[pos]]가 없습니다. 긍정 프롬프트를 넣는 칸에 [[pos]]를 적어 주세요.");
    }
    wf = JSON.parse(raw);
    substituteComfyPlaceholders(wf, values);
    applyComfyRandomSeeds(wf, values.seed);
    return wf;
  }

  async function generateViaComfy(nai, main, neg, captions) {
    const baseUrl = comfyBaseUrl(nai);
    const timeoutMs = backendTimeoutMs(nai);
    const seed = Number(nai.seed ?? 0) || Math.floor(Math.random() * 4294967295) || 1;
    const values = buildComfyPlaceholderValues({ main, neg, captions, nai, seed });
    const wf = buildComfyWorkflowFromTemplate(nai.comfy_workflow_json, values);
    dbg("comfy.generate.start", {
      message: baseUrl,
      prompt_len: String(main || "").length,
      chars: (captions || []).length,
      nodes: Object.keys(wf).length,
      focus: true,
    });
    return withGenerateMutex(async () => {
      const promptId = await comfySubmitPrompt(baseUrl, wf);
      dbg("comfy.generate.submitted", { message: promptId.slice(0, 8), focus: true });
      const ref = await comfyWaitForImage(baseUrl, promptId, { timeoutMs });
      const bytes = await comfyFetchViewImage(baseUrl, ref);
      dbg("comfy.generate.done", { bytes: bytes?.byteLength || 0, focus: true });
      if (!bytes || bytes.byteLength < 256) {
        throw new Error(`ComfyUI 응답 이미지가 너무 짧음 (${bytes?.byteLength || 0}B)`);
      }
      return [bytes, seed];
    });
  }

  async function generateT2i(token, req, apiUrl, opts = {}) {
    const payload = {
      input: req.prompt,
      model: resolveModel(req.model),
      action: "generate",
      parameters: buildBaseParameters(req),
    };
    dbg("nai.generate.start", {
      message: payload.model,
      prompt_len: String(req.prompt || "").length,
      chars: (req.characters || []).length,
      has_char_refs: Boolean(req.character_refs?.length),
      has_vibes: Boolean(req.vibes?.length),
    });
    const zipBytes = await naiPost(token, payload, apiUrl, opts);
    const spanUnzip = dbgSpan("nai.unzip");
    try {
      const rawBytes = await unzipFirstEntry(new Uint8Array(zipBytes));
      const isPng = isPngBytes(new Uint8Array(rawBytes));
      spanUnzip.end({ bytes: rawBytes?.byteLength || 0, is_png: isPng, zip_bytes: zipBytes?.byteLength || 0 });
      if (!isPng) dbg("nai.unzip", { message: "unzipped but not PNG magic", bytes: rawBytes?.byteLength || 0 }, "warn");
      return { raw_bytes: rawBytes, seed: req.seed || 0 };
    } catch (err) {
      spanUnzip.fail(err, { zip_bytes: zipBytes?.byteLength || 0 });
      throw err;
    }
  }

  async function getAnlas(token) {
    const resp = await networkFetch(ANLAS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = Number(resp?.status || 0);
    if (status === 401) throw new Error("인증 실패 (401). API 토큰을 확인하세요.");
    if (status >= 400) throw new Error(`Anlas 조회 실패: HTTP ${status}`);
    const data = await resp.json();
    const steps = data.trainingStepsLeft || {};
    const fixed = steps.fixedTrainingStepsLeft || 0;
    const purchased = steps.purchasedTrainingSteps || 0;
    const opus = data.perks?.unlimitedMaxPriority || false;
    return { fixed, purchased, total: fixed + purchased, opus };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function makeFetchError(status, data, message) {
    const err = new Error(message || data?.error?.message || data?.message || `HTTP ${status}`);
    err.status = status;
    err.data = data;
    return err;
  }

  let deviceStorePromise = null;

  async function getDeviceStore() {
    if (deviceStorePromise) return deviceStorePromise;
    deviceStorePromise = (async () => {
      const g = globalThis.risuai;
      // Preferred: IndexedDB via localforage (JSON-capable, device-local).
      if (typeof g?.getLocalPluginStorage === "function") {
        try {
          const span = dbgSpan("storage.open");
          const api = await g.getLocalPluginStorage();
          if (api?.getItem && api?.setItem) {
            span.end({ message: "idb/getLocalPluginStorage" });
            return { kind: "idb", api };
          }
          span.end({ message: "getLocalPluginStorage returned unusable api" }, "warn");
        } catch (err) {
          dbg("storage.open", { message: String(err?.message || err) }, "error");
          console.warn("[Inlay Nexus] getLocalPluginStorage failed", err?.message || err);
        }
      }
      // Fallback only: save-file scoped storage (can stall on large PNG).
      if (g?.pluginStorage?.getItem && g?.pluginStorage?.setItem) {
        dbg("storage.open", { message: "fallback pluginStorage (save-file)" }, "warn");
        console.warn("[Inlay Nexus] falling back to pluginStorage (save-file scoped)");
        return { kind: "plugin", api: g.pluginStorage };
      }
      dbg("storage.open", { message: "no storage API" }, "error");
      throw new Error("기기 로컬 IndexedDB 저장소(getLocalPluginStorage)를 사용할 수 없습니다.");
    })().catch((error) => {
      deviceStorePromise = null;
      throw error;
    });
    return deviceStorePromise;
  }

  function legacyPluginStorage() {
    return globalThis.risuai?.pluginStorage || null;
  }

  async function psGet(key, legacyKey) {
    try {
      const { kind, api } = await getDeviceStore();
      let v = await api.getItem(key);
      if (v != null && v !== "") return v;
      // One-time migrate from save-file pluginStorage → IndexedDB.
      if (kind === "idb" && legacyKey) {
        const old = legacyPluginStorage();
        if (old?.getItem) {
          try {
            const legacy = await old.getItem(legacyKey);
            if (legacy != null && legacy !== "") {
              await api.setItem(key, legacy);
              return legacy;
            }
          } catch (_) {}
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  async function psSet(key, value, opts = {}) {
    const { kind, api } = await getDeviceStore();
    const approx =
      typeof value === "string"
        ? value.length
        : (() => {
            try {
              return JSON.stringify(value).length;
            } catch (_) {
              return 0;
            }
          })();
    const large = approx > 50_000;
    const span = large ? dbgSpan("storage.set.large") : null;
    try {
      await api.setItem(key, value);
      if (span) span.end({ message: key, bytes: approx, kind, background: true });
      else if (approx > 8_000) dbg("storage.set", { message: key, bytes: approx, kind, background: true });
      return true;
    } catch (err) {
      if (span) span.fail(err, { message: key, bytes: approx, kind, background: true });
      else dbg("storage.set", { message: `${key}: ${err?.message || err}`, bytes: approx, kind, background: true }, "error");
      throw err;
    }
  }

  async function psRemove(key) {
    try {
      const { api } = await getDeviceStore();
      if (api?.removeItem) await api.removeItem(key);
    } catch (_) {}
  }

  function storeKeyOf(store, key) {
    if (store === "characters") {
      if (Array.isArray(key)) return `${key[0]}\t${key[1]}`;
      if (key && typeof key === "object") return `${key.scope}\t${key.id}`;
    }
    return String(key);
  }

  function recordKeyOf(store, value) {
    if (!value || typeof value !== "object") return "";
    if (store === "meta") return String(value.key || "");
    if (store === "characters") return `${value.scope}\t${value.id}`;
    return String(value.id || "");
  }

  function abToBase64(buf) {
    if (!buf) return "";
    return bytesToBase64(buf instanceof ArrayBuffer ? buf : buf);
  }

  async function abToBase64Async(buf) {
    if (!buf) return "";
    return bytesToBase64Async(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf);
  }

  function slimJobRowForDisk(row) {
    if (!row || typeof row !== "object") return row;
    const out = { ...row };
    if (!out.result_json) return out;
    try {
      const parsed = JSON.parse(out.result_json);
      if (!parsed || typeof parsed !== "object") return out;
      const slim = { ...parsed };
      delete slim.tagged;
      delete slim.appearance;
      delete slim.debug_tail;
      if (Array.isArray(slim.cards)) {
        slim.cards = slim.cards.map((c) => {
          if (!c || typeof c !== "object") return c;
          const card = { ...c };
          if (typeof card.image_url === "string" && card.image_url.startsWith("data:")) card.image_url = "";
          return card;
        });
      }
      out.result_json = JSON.stringify(slim);
    } catch (_) {}
    return out;
  }

  async function persistStore(store) {
    if (store === "images") {
      // Index only metadata — PNG bytes live in per-id IndexedDB keys.
      const index = {};
      for (const [k, v] of memStores.images) {
        const bytes = v.png?.byteLength || 0;
        index[k] = {
          id: v.id,
          location: v.location || null,
          has_png: Boolean(v.png),
          png_bytes: bytes,
          storage: "indexeddb",
          storage_key: IMAGE_KEY(k),
        };
      }
      await psSet(STORE_KEY("images"), index, { background: true });
      return;
    }
    const obj = {};
    for (const [k, v] of memStores[store]) {
      if (store === "meta" && v?.key === "reference_image") {
        obj[k] = { key: "reference_image", has_png: Boolean(v.png), updated_at: v.updated_at || 0 };
        continue;
      }
      if (store === "meta" && v?.key === "vibe_transfer") {
        obj[k] = {
          key: "vibe_transfer",
          has_png: Boolean(v.png),
          has_encoded: Boolean(v.encoded),
          model: v.model || "",
          information_extracted: v.information_extracted ?? 1.0,
          updated_at: v.updated_at || 0,
        };
        continue;
      }
      if (store === "jobs") {
        obj[k] = slimJobRowForDisk(v);
        continue;
      }
      obj[k] = v;
    }
    await psSet(STORE_KEY(store), obj, { background: true });
  }

  function base64ToAb(b64) {
    if (!b64) return null;
    return base64ToBytes(b64).buffer;
  }

  function schedulePersist(store) {
    persistChain = persistChain
      .then(async () => {
        if (pauseDiskPersist) {
          dbg("storage.persist.skip", { message: store, background: true });
          return;
        }
        await persistStore(store);
      })
      .catch((err) => console.warn("[Inlay Nexus] persist failed", store, err?.message || err));
  }

  async function openDb() {
    if (storeReady) return storeReady;
    storeReady = (async () => {
      for (const store of STORE_NAMES) {
        const raw = await psGet(STORE_KEY(store), LEGACY_STORE_KEY(store));
        if (raw == null || raw === "") continue;
        let obj = raw;
        if (typeof raw === "string") {
          try {
            obj = JSON.parse(raw);
          } catch (_) {
            continue;
          }
        }
        if (!obj || typeof obj !== "object") continue;
        const map = memStores[store];
        for (const [k, v] of Object.entries(obj)) {
          if (store === "images") {
            let png = null;
            if (v?.has_png) png = base64ToAb(await psGet(IMAGE_KEY(k), LEGACY_IMAGE_KEY(k)));
            map.set(k, { id: v.id || k, location: v.location || {}, png });
          } else if (store === "meta" && (v?.key === "reference_image" || k === "reference_image")) {
            const png = base64ToAb(await psGet(REF_IMAGE_KEY, LEGACY_REF_IMAGE_KEY));
            map.set("reference_image", { key: "reference_image", png });
          } else if (store === "meta" && (v?.key === "vibe_transfer" || k === "vibe_transfer")) {
            const png = base64ToAb(await psGet(VIBE_IMAGE_KEY));
            let data = await psGet(VIBE_DATA_KEY);
            if (typeof data === "string") {
              try {
                data = JSON.parse(data);
              } catch (_) {
                data = null;
              }
            }
            map.set("vibe_transfer", {
              key: "vibe_transfer",
              png,
              encoded: data?.encoded || "",
              model: data?.model || v?.model || "",
              information_extracted: data?.information_extracted ?? v?.information_extracted ?? 1.0,
            });
          } else {
            map.set(k, v);
          }
        }
      }
      return true;
    })().catch((error) => {
      storeReady = null;
      throw error;
    });
    return storeReady;
  }

  async function idbGet(store, key) {
    await openDb();
    const k = storeKeyOf(store, key);
    const row = memStores[store].get(k);
    return row == null ? undefined : row;
  }

  async function idbPut(store, value, opts = {}) {
    await openDb();
    const k = recordKeyOf(store, value);
    if (!k) throw new Error(`invalid ${store} key`);
    const persist = opts.persist !== false;
    if (store === "images") {
      const png = value.png || null;
      memStores.images.set(k, { id: value.id, location: value.location || {}, png });
      // Queue large base64 writes — never await on the job critical path.
      if (png) {
        imagePersistChain = imagePersistChain
          .then(async () => {
            const b64 = await abToBase64Async(png);
            await psSet(IMAGE_KEY(k), b64, { background: true });
          })
          .catch((err) => console.warn("[Inlay Nexus] image persist failed", k, err?.message || err));
      } else {
        imagePersistChain = imagePersistChain
          .then(() => psRemove(IMAGE_KEY(k)))
          .catch(() => {});
      }
      if (persist) schedulePersist("images");
      return k;
    }
    if (store === "meta" && value.key === "reference_image") {
      memStores.meta.set("reference_image", { key: "reference_image", png: value.png || null });
      if (value.png) {
        imagePersistChain = imagePersistChain
          .then(async () => {
            const b64 = await abToBase64Async(value.png);
            await psSet(REF_IMAGE_KEY, b64, { background: true });
          })
          .catch((err) => console.warn("[Inlay Nexus] ref persist failed", err?.message || err));
      } else {
        imagePersistChain = imagePersistChain
          .then(() => psRemove(REF_IMAGE_KEY))
          .catch(() => {});
      }
      if (persist) schedulePersist("meta");
      return "reference_image";
    }
    if (store === "meta" && value.key === "vibe_transfer") {
      const row = {
        key: "vibe_transfer",
        png: value.png || null,
        encoded: value.encoded || "",
        model: value.model || "",
        information_extracted: value.information_extracted ?? 1.0,
      };
      memStores.meta.set("vibe_transfer", row);
      imagePersistChain = imagePersistChain
        .then(async () => {
          if (row.png) {
            const b64 = await abToBase64Async(row.png);
            await psSet(VIBE_IMAGE_KEY, b64, { background: true });
          } else {
            await psRemove(VIBE_IMAGE_KEY);
          }
          if (row.encoded) {
            await psSet(
              VIBE_DATA_KEY,
              {
                encoded: row.encoded,
                model: row.model,
                information_extracted: row.information_extracted,
              },
              { background: true },
            );
          } else {
            await psRemove(VIBE_DATA_KEY);
          }
        })
        .catch((err) => console.warn("[Inlay Nexus] vibe persist failed", err?.message || err));
      if (persist) schedulePersist("meta");
      return "vibe_transfer";
    }
    memStores[store].set(k, value);
    if (persist) schedulePersist(store);
    return k;
  }

  async function idbDelete(store, key) {
    await openDb();
    const k = storeKeyOf(store, key);
    memStores[store].delete(k);
    if (store === "images") await psRemove(IMAGE_KEY(k));
    if (store === "meta" && k === "reference_image") await psRemove(REF_IMAGE_KEY);
    if (store === "meta" && k === "vibe_transfer") {
      await psRemove(VIBE_IMAGE_KEY);
      await psRemove(VIBE_DATA_KEY);
    }
    schedulePersist(store);
    // Drop cached data URL for deleted images
    if (store === "images" && blobUrlCache.has(k)) {
      blobUrlCache.delete(k);
    }
    return true;
  }

  async function idbGetAll(store) {
    await openDb();
    return [...memStores[store].values()];
  }

  async function loadSettingsFromStorage() {
    try {
      const raw = await psGet(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
      if (raw == null || raw === "") return deepcopy(DEFAULT_CONFIG);
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== "object") return deepcopy(DEFAULT_CONFIG);
      const migrate = globalThis.__INLAY_SETTINGS_SCHEMA__?.migrateSettings;
      const migrated = typeof migrate === "function" ? migrate(parsed) : parsed;
      const config = deepMerge(DEFAULT_CONFIG, migrated);
      if (JSON.stringify(parsed) !== JSON.stringify(migrated)) await saveSettingsToStorage(config);
      return config;
    } catch (err) {
      console.warn("[Inlay Nexus] settings load failed", err?.message || err);
    }
    return deepcopy(DEFAULT_CONFIG);
  }

  async function saveSettingsToStorage(config) {
    // Store object directly (IndexedDB/localforage JSON-serializes).
    const payload = deepcopy(config);
    await psSet(SETTINGS_KEY, payload);
    // Verify round-trip so silent storage failures surface immediately.
    const check = await psGet(SETTINGS_KEY);
    if (check == null) throw new Error("설정 저장 실패: IndexedDB(getLocalPluginStorage)에 기록되지 않았습니다.");
  }

  function getExternalPrompts() {
    return globalThis.__INLAY_NATIVE_PROMPTS__ || {};
  }

  function promptText(key) {
    const ext = getExternalPrompts();
    if (cleanText(ext[key])) return cleanText(ext[key]);
    return PROMPT_FALLBACKS[key] || "";
  }

  async function ensureBlobUrl(id) {
    if (!id) return "";
    if (blobUrlCache.has(id)) return blobUrlCache.get(id);
    const span = dbgSpan("image.data_url");
    const rec = await idbGet("images", id);
    if (!rec?.png) {
      span.end({ message: `missing png ${id}`, id, background: true }, "warn");
      return "";
    }
    // Host SafeElement.setInnerHTML → DOMPurify strips blob: URLs but keeps data:image.
    const mime = rec.mime || sniffImageMime(rec.png);
    const b64 = await abToBase64Async(rec.png);
    const url = `data:${mime};base64,${b64}`;
    blobUrlCache.set(id, url);
    span.end({ message: id, bytes: rec.png.byteLength || 0, mime, url_len: url.length, focus: true });
    return url;
  }

  function resolveImageUrl(cardOrId) {
    const id = typeof cardOrId === "string" ? cardOrId : cardOrId?.id;
    if (!id) return "";
    return blobUrlCache.get(id) || "";
  }

  async function publishImage(id, png, location = null) {
    const span = dbgSpan("image.publish");
    blobUrlCache.delete(id);
    let bytes = png;
    let mime = sniffImageMime(png);
    try {
      const webp = await encodeWebpQuality(png, 0.8);
      if (webp) {
        bytes = webp;
        mime = "image/webp";
      }
    } catch (err) {
      dbg("image.webp", { message: String(err?.message || err), id }, "warn");
    }
    await idbPut("images", { id, png: bytes, mime, location: location || {} });
    // Data URL encode can stall — try briefly, else finish in background.
    let url = "";
    try {
      const pending = ensureBlobUrl(id);
      url = await Promise.race([
        pending,
        sleep(5000).then(() => resolveImageUrl(id) || ""),
      ]);
      if (!url) {
        dbg("image.data_url.defer", { message: id, bytes: bytes?.byteLength || 0, mime, focus: true }, "warn");
        pending.catch((err) => console.warn("[Inlay Nexus] deferred data URL failed", err?.message || err));
      }
    } catch (err) {
      dbg("image.data_url", { message: String(err?.message || err), id }, "warn");
      Promise.resolve()
        .then(() => ensureBlobUrl(id))
        .catch(() => {});
    }
    span.end({
      message: id,
      bytes: bytes?.byteLength || 0,
      src_bytes: png?.byteLength || 0,
      mime,
      has_url: Boolean(url),
      has_location: Boolean(location && Object.keys(location).length),
      focus: true,
    });
    return url;
  }

  const warmQueued = new Set();
  const warmQueue = [];
  let warmActive = 0;

  function enqueueWarm(id) {
    const key = String(id || "");
    if (!key || blobUrlCache.has(key) || warmQueued.has(key)) return;
    warmQueued.add(key);
    warmQueue.push(key);
    pumpWarm();
  }

  function pumpWarm() {
    while (warmActive < 2 && warmQueue.length) {
      const id = warmQueue.shift();
      warmActive += 1;
      ensureBlobUrl(id)
        .catch(() => {})
        .finally(() => {
          warmActive -= 1;
          warmQueued.delete(id);
          pumpWarm();
        });
    }
  }

  async function warmImages(ids = [], { concurrency = 2 } = {}) {
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    const limit = Math.max(1, Number(concurrency) || 2);
    for (let i = 0; i < list.length; i += limit) {
      await Promise.all(list.slice(i, i + limit).map((id) => ensureBlobUrl(id).catch(() => "")));
    }
    return list.map((id) => resolveImageUrl(id)).filter(Boolean);
  }

  /**
   * Attach image URLs onto gallery/card payloads.
   * opts.ids — only these ids are encoded immediately; others use cache + background warm
   * opts.cachedOnly — never encode synchronously (gallery list default)
   */
  async function attachImageUrls(obj, opts = {}) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) obj[i] = await attachImageUrls(obj[i], opts);
      return obj;
    }
    const isCard = typeof obj.id === "string" && (
      typeof obj.image_url === "string"
      || obj.image_path != null
      || "shot_index" in obj
      || "main_prompt" in obj
    );
    if (isCard) {
      const id = String(obj.id);
      const filter = opts.ids != null ? new Set([...opts.ids].map(String)) : null;
      const eager = !opts.cachedOnly && (!filter || filter.has(id));
      if (eager) {
        const url = await ensureBlobUrl(id);
        if (url) obj.image_url = url;
      } else {
        obj.image_url = resolveImageUrl(id) || "";
        if (!obj.image_url) enqueueWarm(id);
      }
      return obj;
    }
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === "object") {
        obj[key] = await attachImageUrls(obj[key], opts);
      }
    }
    return obj;
  }

  let refPreviewBlobUrl = "";
  let vibePreviewBlobUrl = "";

  function refPreviewUrl() {
    return refPreviewBlobUrl || "";
  }

  function vibePreviewUrl() {
    return vibePreviewBlobUrl || "";
  }

  function pngToDataUrl(png) {
    if (!png) return "";
    const mime = sniffImageMime(png);
    return `data:${mime};base64,${abToBase64(png)}`;
  }

  class InlayNexus {
    constructor() {
      this.config = deepcopy(DEFAULT_CONFIG);
      this._cfgLock = Promise.resolve();
      /** @type {Map<string, { epoch: number, jobId: string }>} */
      this._jobEpochByKey = new Map();
      /** @type {Map<string, { key: string, epoch: number, cancelRequested: boolean, publishedIds: string[] }>} */
      this._jobRunMeta = new Map();
      /** Same-message message-reroll lock (not a multi-shot job). */
      this._messageBusyKeys = new Set();
    }

    async init() {
      this.config = await loadSettingsFromStorage();
      await this._seedPrompts();
      await this._migrateAppearanceToCharacters();
      await this._migrateCharacterIdentity();
      const ref = await idbGet("meta", "reference_image");
      if (ref?.png) {
        refPreviewBlobUrl = pngToDataUrl(ref.png);
      }
      const vibe = await idbGet("meta", "vibe_transfer");
      if (vibe?.png) {
        vibePreviewBlobUrl = pngToDataUrl(vibe.png);
      }
    }

    async _seedPrompts() {
      const pack = await idbGet("meta", "prompt:__pack__");
      const force = !pack || pack.text !== PROMPT_PACK;
      const now = Date.now() / 1000;
      for (const key of PROMPT_KEYS) {
        const existing = await idbGet("meta", `prompt:${key}`);
        if (existing && !(force && FORCE_PROMPT_KEYS.includes(key))) continue;
        await idbPut("meta", { key: `prompt:${key}`, text: promptText(key), updated_at: now });
      }
      await idbPut("meta", { key: "prompt:__pack__", text: PROMPT_PACK, updated_at: now });
    }

    async _migrateAppearanceToCharacters() {
      const chars = await idbGetAll("characters");
      if (chars.length) return;
      const appearanceRows = await idbGetAll("meta");
      const appRows = appearanceRows.filter((r) => r.key?.startsWith("appearance:"));
      if (!appRows.length) return;
      for (const row of appRows) {
        const sessionId = row.key.slice("appearance:".length);
        const mapping = row.value || {};
        for (const [name, tags] of Object.entries(mapping)) {
          const rec = normalizeCharacterRecord({ name, tags }, name);
          if (rec) await this.upsertCharacter(sessionId, rec);
        }
      }
    }

    async getPrompt(key) {
      const row = await idbGet("meta", `prompt:${key}`);
      if (row?.text != null) return row.text;
      return promptText(key);
    }

    async setPrompt(key, text) {
      const now = Date.now() / 1000;
      await idbPut("meta", { key: `prompt:${key}`, text, updated_at: now });
      return { ok: true, key, updated_at: now };
    }

    async listPrompts() {
      const all = await idbGetAll("meta");
      const byKey = new Map(
        all
          .filter((r) => r.key?.startsWith("prompt:") && !r.key.startsWith("prompt:__"))
          .map((r) => [r.key.slice(7), { key: r.key.slice(7), text: r.text || "", updated_at: r.updated_at || 0 }]),
      );
      const ordered = [];
      for (const key of PROMPT_KEYS) {
        if (byKey.has(key)) ordered.push(byKey.get(key));
        else ordered.push({ key, text: promptText(key), updated_at: 0 });
        byKey.delete(key);
      }
      for (const row of byKey.values()) ordered.push(row);
      return ordered;
    }

    async saveConfig() {
      const snapshot = deepcopy(this.config);
      const pending = this._cfgLock
        .catch(() => {})
        .then(() => saveSettingsToStorage(snapshot));
      this._cfgLock = pending;
      await pending;
    }

    async _migrateCharacterIdentity() {
      const rows = await idbGetAll("characters");
      for (const row of rows) {
        if (Number(row.schema_version || 0) >= 2) continue;
        const rec = normalizeCharacterRecord(row);
        if (!rec) continue;
        await idbPut("characters", {
          ...row,
          ...rec,
          scope: row.scope,
          updated_at: row.updated_at || Date.now() / 1000,
        });
      }
    }

    exportSettingsJson() {
      const serialize = globalThis.__INLAY_SETTINGS_SCHEMA__?.exportSettings;
      if (typeof serialize !== "function") throw new Error("settings exporter unavailable");
      return serialize(this.config);
    }

    async importSettingsJson(text) {
      const parse = globalThis.__INLAY_SETTINGS_SCHEMA__?.importSettings;
      if (typeof parse !== "function") throw new Error("settings importer unavailable");
      const imported = parse(String(text ?? "").slice(0, 2_000_001));
      const previous = deepcopy(this.config);
      await idbPut("meta", { key: "settings_backup", value: previous, updated_at: Date.now() / 1000 });
      const next = deepMerge(DEFAULT_CONFIG, imported);
      next.llm = { ...(next.llm || {}), api_key: previous.llm?.api_key || "" };
      next.nai = { ...(next.nai || {}), api_key: previous.nai?.api_key || "" };
      next.auth_token = previous.auth_token || "";
      this.config = next;
      await this.saveConfig();
      return { ok: true, settings: this.publicSettings() };
    }

    async resetSettings() {
      const previous = deepcopy(this.config);
      await idbPut("meta", { key: "settings_backup", value: previous, updated_at: Date.now() / 1000 });
      const next = deepcopy(DEFAULT_CONFIG);
      next.llm = { ...(next.llm || {}), api_key: previous.llm?.api_key || "" };
      next.nai = { ...(next.nai || {}), api_key: previous.nai?.api_key || "" };
      next.auth_token = previous.auth_token || "";
      // Card style presets are user content — never wipe on settings reset.
      const prevCard = previous.card || {};
      next.card = {
        ...(next.card || {}),
        presets: Array.isArray(prevCard.presets) ? deepcopy(prevCard.presets) : (next.card?.presets || []),
        active_preset_id: String(prevCard.active_preset_id || next.card?.active_preset_id || ""),
        custom_pos: String(prevCard.custom_pos ?? next.card?.custom_pos ?? ""),
        custom_neg: String(prevCard.custom_neg ?? next.card?.custom_neg ?? ""),
      };
      this.config = next;
      await this.saveConfig();
      return { ok: true, settings: this.publicSettings() };
    }

    health() {
      const nai = this.config.nai || {};
      const llm = this.config.llm || {};
      let cards = 0;
      let images = 0;
      let pngBytes = 0;
      let folders = 0;
      try {
        cards = memStores.cards.size;
        images = memStores.images.size;
        const folderKeys = new Set();
        for (const img of memStores.images.values()) {
          pngBytes += img.png?.byteLength || 0;
          const loc = img.location || {};
          const cid = cleanText(loc.character_id || "", 200) || "unknown";
          const chid = cleanText(loc.chat_id || "", 200) || "unknown";
          folderKeys.add(`${cid}|${chid}`);
        }
        folders = folderKeys.size;
      } catch (_) {}
      return {
        ok: true,
        version: VERSION,
        pid: 0,
        source_file: "native",
        nai_configured: imageBackendKind(nai) === "comfy" ? comfyConfigured(nai) : Boolean(cleanText(nai.api_key)),
        image_backend: imageBackendKind(nai),
        llm_configured: llmConfigured(llm),
        port: 0,
        image_mode: "data-url",
        storage: "indexeddb",
        storage_api: "getLocalPluginStorage",
        storage_scope: "device-local",
        cards,
        images,
        folders,
        png_bytes: pngBytes,
        last_stage: debugLastStage,
        focus_stage: debugFocusStage,
        last_error: debugLastError,
        debug_events: debugEvents.length,
      };
    }

    publicSettings() {
      const cfg = deepcopy(this.config);
      if (cfg.nai?.api_key) {
        cfg.nai.api_key = "";
        cfg.nai.api_key_configured = true;
      } else cfg.nai = { ...cfg.nai, api_key_configured: false };
      if (cfg.llm?.api_key) {
        cfg.llm.api_key = "";
        cfg.llm.api_key_configured = true;
      } else cfg.llm = { ...cfg.llm, api_key_configured: false };
      if (cfg.llm?.service_account_json) {
        cfg.llm.service_account_json = "";
        cfg.llm.service_account_configured = true;
      } else cfg.llm = { ...cfg.llm, service_account_configured: false };
      const nai = cfg.nai || {};
      nai.backend = imageBackendKind(nai);
      nai.image_backend = nai.backend;
      nai.comfy_configured = comfyConfigured(nai);
      const refOn = !["", "none", "off", "false", "0"].includes(cleanText(nai.image_reference));
      nai.image_reference_configured = Boolean(refOn && this.hasReferenceImageSync());
      if (!nai.image_reference) nai.image_reference = nai.image_reference_configured ? "file" : "none";
      if (nai.image_reference_configured && refPreviewBlobUrl) nai.reference_preview_url = refPreviewBlobUrl;
      const vibeOn = !["", "none", "off", "false", "0"].includes(cleanText(nai.vibe_transfer));
      nai.vibe_transfer_configured = Boolean(vibeOn && this.hasVibeTransferSync());
      if (!nai.vibe_transfer) nai.vibe_transfer = nai.vibe_transfer_configured ? "file" : "none";
      if (nai.vibe_transfer_configured && vibePreviewBlobUrl) nai.vibe_preview_url = vibePreviewBlobUrl;
      cfg.nai = nai;
      cfg.card = cfg.card || {};
      cfg.card.character_max = characterMaxLimit(cfg.card);
      cfg.database_path = "indexeddb:getLocalPluginStorage";
      cfg.images_dir = "indexeddb:inx_nximg_*";
      cfg.prompts_dir = "embedded";
      cfg.storage = {
        ...(cfg.storage || {}),
        backend: "indexeddb",
        api: "getLocalPluginStorage",
        image_encoding: "base64",
        scope: "device-local",
        image_mode: "data-url",
      };
      return cfg;
    }

    hasReferenceImageSync() {
      return Boolean(refPreviewBlobUrl);
    }

    async hasReferenceImage() {
      const ref = await idbGet("meta", "reference_image");
      return Boolean(ref?.png && ref.png.byteLength > 32);
    }

    async getReferenceImageBytes() {
      const ref = await idbGet("meta", "reference_image");
      return ref?.png || null;
    }

    async setReferenceImage(imageBytes) {
      if (!imageBytes || imageBytes.byteLength < 32) throw new Error("참조 이미지가 비어 있습니다");
      if (imageBytes.byteLength > 12 * 1024 * 1024) throw new Error("참조 이미지가 너무 큽니다 (최대 12MB)");
      await idbPut("meta", { key: "reference_image", png: imageBytes });
      refPreviewBlobUrl = pngToDataUrl(imageBytes);
      this.config.nai = this.config.nai || {};
      this.config.nai.image_reference = "file";
      await this.saveConfig();
      return {
        ok: true,
        image_reference: "file",
        configured: true,
        bytes: imageBytes.byteLength,
        preview_url: "/v1/nai/reference.png",
      };
    }

    async clearReferenceImage() {
      await idbDelete("meta", "reference_image");
      refPreviewBlobUrl = "";
      this.config.nai = this.config.nai || {};
      this.config.nai.image_reference = "none";
      await this.saveConfig();
      return { ok: true, image_reference: "none", configured: false };
    }

    hasVibeTransferSync() {
      return Boolean(vibePreviewBlobUrl);
    }

    async hasVibeTransfer() {
      const vibe = await idbGet("meta", "vibe_transfer");
      return Boolean(vibe?.encoded && vibe?.png && vibe.png.byteLength > 32);
    }

    async getVibeTransfer() {
      return (await idbGet("meta", "vibe_transfer")) || null;
    }

    async getVibeImageBytes() {
      const vibe = await idbGet("meta", "vibe_transfer");
      return vibe?.png || null;
    }

    async setVibeTransfer(imageBytes, opts = {}) {
      if (!imageBytes || imageBytes.byteLength < 32) throw new Error("Vibe 이미지가 비어 있습니다");
      if (imageBytes.byteLength > 12 * 1024 * 1024) throw new Error("Vibe 이미지가 너무 큽니다 (최대 12MB)");
      const token = cleanText(this.config.nai?.api_key);
      if (!token) throw new Error("NAI api_key가 설정되지 않았습니다. encode-vibe에 키가 필요합니다.");
      const model = modelToNaia(opts.model || this.config.nai?.model || "nai-diffusion-4-5-full");
      let ie = Number(opts.information_extracted ?? this.config.nai?.vibe_transfer_information_extracted ?? 1.0);
      if (Number.isNaN(ie)) ie = 1.0;
      ie = Math.max(0, Math.min(1, ie));
      const encoded = await encodeVibe(token, imageBytes, model, ie);
      await idbPut("meta", {
        key: "vibe_transfer",
        png: imageBytes,
        encoded,
        model: resolveModel(model),
        information_extracted: ie,
      });
      vibePreviewBlobUrl = pngToDataUrl(imageBytes);
      this.config.nai = this.config.nai || {};
      this.config.nai.vibe_transfer = "file";
      if (opts.strength != null && !Number.isNaN(Number(opts.strength))) {
        this.config.nai.vibe_transfer_strength = Math.max(0, Math.min(1, Number(opts.strength)));
      }
      this.config.nai.vibe_transfer_information_extracted = ie;
      await this.saveConfig();
      return {
        ok: true,
        vibe_transfer: "file",
        configured: true,
        bytes: imageBytes.byteLength,
        encoded_bytes: encoded.length,
        model: resolveModel(model),
        information_extracted: ie,
        preview_url: "/v1/nai/vibe.png",
      };
    }

    async clearVibeTransfer() {
      await idbDelete("meta", "vibe_transfer");
      vibePreviewBlobUrl = "";
      this.config.nai = this.config.nai || {};
      this.config.nai.vibe_transfer = "none";
      await this.saveConfig();
      return { ok: true, vibe_transfer: "none", configured: false };
    }

    async ensureVibeEncoded() {
      const vibe = await this.getVibeTransfer();
      if (!vibe?.png || vibe.png.byteLength < 32) return null;
      const token = cleanText(this.config.nai?.api_key);
      if (!token) throw new Error("NAI api_key가 설정되지 않았습니다.");
      const model = resolveModel(modelToNaia(this.config.nai?.model || "nai-diffusion-4-5-full"));
      let ie = Number(this.config.nai?.vibe_transfer_information_extracted ?? 1.0);
      if (Number.isNaN(ie)) ie = 1.0;
      ie = Math.max(0, Math.min(1, ie));
      const needEncode =
        !cleanText(vibe.encoded) ||
        cleanText(vibe.model) !== model ||
        Math.abs(Number(vibe.information_extracted ?? 1) - ie) > 0.001;
      if (!needEncode) return vibe;
      const encoded = await encodeVibe(token, vibe.png, model, ie);
      const next = { ...vibe, key: "vibe_transfer", encoded, model, information_extracted: ie };
      await idbPut("meta", next);
      return next;
    }

    async updateSettings(payload) {
      payload = payload && typeof payload === "object" ? payload : {};
      const nai = { ...(payload.nai || {}) };
      const llm = { ...(payload.llm || {}) };
      const card = { ...(payload.card || {}) };
      if ("api_key" in nai) {
        const key = nai.api_key;
        delete nai.api_key;
        delete nai.api_key_configured;
        if (cleanText(key)) {
          this.config.nai = this.config.nai || {};
          this.config.nai.api_key = key;
        }
        if (nai.clearApiKey || payload.clear_nai_key) {
          this.config.nai = this.config.nai || {};
          this.config.nai.api_key = "";
        }
        delete nai.clearApiKey;
      }
      if ("api_key" in llm) {
        const key = llm.api_key;
        delete llm.api_key;
        delete llm.api_key_configured;
        if (cleanText(key)) {
          this.config.llm = this.config.llm || {};
          this.config.llm.api_key = key;
        }
        if (llm.clearApiKey || payload.clear_llm_key) {
          this.config.llm = this.config.llm || {};
          this.config.llm.api_key = "";
        }
        delete llm.clearApiKey;
      }
      if ("service_account_json" in llm) {
        const sa = llm.service_account_json;
        delete llm.service_account_json;
        delete llm.service_account_configured;
        if (cleanText(sa)) {
          this.config.llm = this.config.llm || {};
          this.config.llm.service_account_json = sa;
        }
        if (llm.clearServiceAccount || payload.clear_llm_service_account) {
          this.config.llm = this.config.llm || {};
          this.config.llm.service_account_json = "";
        }
        delete llm.clearServiceAccount;
      }
      if (Object.keys(card).length) {
        // Replace arrays (presets) outright — deepMerge already does, but be explicit.
        const merged = deepMerge(this.config.card || {}, card);
        if (Array.isArray(card.presets)) merged.presets = card.presets;
        if ("active_preset_id" in card) merged.active_preset_id = card.active_preset_id;
        if ("custom_pos" in card) merged.custom_pos = card.custom_pos;
        if ("custom_neg" in card) merged.custom_neg = card.custom_neg;
        this.config.card = merged;
        this.config.card.character_max = characterMaxLimit(this.config.card);
      }
      if (Object.keys(nai).length) this.config.nai = deepMerge(this.config.nai || {}, nai);
      if (Object.keys(llm).length) this.config.llm = deepMerge(this.config.llm || {}, llm);
      for (const key of ["bind_host", "port", "auth_token"]) {
        if (key in payload) this.config[key] = payload[key];
      }
      await this.saveConfig();
      return { ok: true, settings: this.publicSettings() };
    }

    async listCharacters(scope) {
      const all = await idbGetAll("characters");
      return all
        .filter((r) => r.scope === cleanText(scope, 200))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }))
        .map((row) => {
          let aliases = row.aliases;
          if (typeof aliases === "string") {
            try {
              aliases = JSON.parse(aliases);
            } catch (_) {
              aliases = parseAliasList(aliases);
            }
          }
          const rec = {
            id: row.id,
            name: row.name,
            aliases: Array.isArray(aliases) ? aliases : parseAliasList(aliases),
            surname: row.surname || "",
            given_name: row.given_name || "",
            surname_variants: parseAliasList(row.surname_variants),
            given_name_variants: parseAliasList(row.given_name_variants),
            priority: Number(row.priority || 0),
            attire_locked: row.attire_locked === true,
            accessories_locked: row.accessories_locked === true,
            schema_version: Number(row.schema_version || 1),
            original: row.original || "",
            appearance: row.appearance || "",
            attire: row.attire || "",
            accessories: row.accessories || "",
            updated_at: row.updated_at,
            scope: row.scope,
          };
          rec.tags = fullTags(rec);
          return rec;
        });
    }

    async getDisabledGlobals(characterId) {
      characterId = cleanText(characterId, 200);
      if (!characterId) return [];
      const all = await idbGetAll("meta");
      return all
        .filter((r) => r.key?.startsWith(`toggle:${characterId}:`) && r.enabled === 0)
        .map((r) => cleanText(r.global_key || r.key.split(":").slice(2).join(":"), 200))
        .filter(Boolean);
    }

    async setDisabledGlobals(characterId, disabledKeys) {
      characterId = cleanText(characterId, 200);
      if (!characterId) return { ok: false, error: { code: "bad_request", message: "character_id required" } };
      const keys = [];
      const seen = new Set();
      for (const raw of disabledKeys || []) {
        const key = cleanText(raw, 200);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
      const all = await idbGetAll("meta");
      for (const row of all) {
        if (row.key?.startsWith(`toggle:${characterId}:`)) await idbDelete("meta", row.key);
      }
      const now = Date.now() / 1000;
      for (const key of keys) {
        await idbPut("meta", { key: `toggle:${characterId}:${key}`, character_id: characterId, global_key: key, enabled: 0, updated_at: now });
      }
      return { ok: true, character_id: characterId, disabled_globals: keys };
    }

    _globalCharKeys(char) {
      const keys = [];
      for (const raw of [char.id, char.name]) {
        const text = cleanText(raw, 200);
        if (!text) continue;
        keys.push(text);
        const low = text.toLowerCase();
        if (low !== text) keys.push(low);
      }
      return [...new Set(keys)];
    }

    _globalToggleKeyDisabled(char, disabled) {
      if (!disabled?.size) return false;
      for (const key of this._globalCharKeys(char)) {
        if (disabled.has(key)) return true;
      }
      return false;
    }

    async getDisabledGlobalsSet(characterId) {
      const list = await this.getDisabledGlobals(characterId);
      return new Set(list);
    }

    async globalEnabledMap(characterId) {
      const disabled = await this.getDisabledGlobalsSet(characterId);
      const out = {};
      for (const char of await this.listCharacters(GLOBAL_SCOPE)) {
        const enabled = !this._globalToggleKeyDisabled(char, disabled);
        for (const key of this._globalCharKeys(char)) out[key] = enabled;
        out[cleanText(char.name, 200)] = enabled;
      }
      return out;
    }

    /**
     * Writes always target the live chat session. Unified is a read-only merge view.
     * (unifiedSessionId kept in signature for call-site compatibility.)
     */
    rosterStoreSessionId(sessionId, _unifiedSessionId = "") {
      return cleanText(sessionId || "", 200);
    }

    async listMergedSessionCharacters(sourceSessionIds = []) {
      const collected = [];
      const seen = new Set();
      for (const raw of sourceSessionIds || []) {
        const sid = cleanText(raw, 200);
        if (!sid || sid === GLOBAL_SCOPE || seen.has(sid)) continue;
        seen.add(sid);
        collected.push(...(await this.listCharacters(sid)));
      }
      return mergeCharactersByAlias(collected);
    }

    async rosterForSession(sessionId, unifiedSessionId = "", characterId = "", sourceSessionIds = []) {
      // Per-chat session is the default source of truth.
      // When unified_chat_priority is ON, read a live merge of linked chat rosters
      // (not a separate __unified__ store). Writes still go to the live session only.
      const prefer = !!(this.config?.card?.unified_chat_priority);
      const sources = (Array.isArray(sourceSessionIds) ? sourceSessionIds : [])
        .map((s) => cleanText(s, 200))
        .filter(Boolean);
      let session;
      if (prefer && sources.length) {
        session = await this.listMergedSessionCharacters(sources);
      } else {
        session = await this.listCharacters(cleanText(sessionId || "", 200));
      }
      characterId = cleanText(characterId || "", 200);
      const disabled = characterId ? await this.getDisabledGlobalsSet(characterId) : new Set();
      const globalChars = (await this.listCharacters(GLOBAL_SCOPE)).filter((c) => !this._globalToggleKeyDisabled(c, disabled));
      const mergeFn = globalThis.__INLAY_ROSTER_MERGE__?.mergeSessionAndGlobalRoster;
      if (typeof mergeFn === "function") {
        return mergeFn(session, globalChars, {
          hasAppearance: characterHasAppearance,
          resolve: resolveCharacter,
          aliasKeys: _characterAliasKeys,
          normalizeName: normalizeAlias,
          fullTags,
          clean: cleanText,
          globalScope: GLOBAL_SCOPE,
        });
      }
      // Fallback if embed missing: attire-only session rows must not hide filled globals.
      const merged = [];
      const sessionIncomplete = new Set();
      for (const schar of session) {
        if (cleanText(schar.name, 200) && !characterHasAppearance(schar)) {
          const globalHit = resolveCharacter(schar.name, globalChars);
          if (globalHit && characterHasAppearance(globalHit)) continue;
          for (const key of _characterAliasKeys(schar)) sessionIncomplete.add(key);
          const nameKey = normalizeAlias(schar.name);
          if (nameKey) sessionIncomplete.add(nameKey);
        }
      }
      for (const gchar of globalChars) {
        const overlay = resolveCharacter(gchar.name, session);
        const gKeys = _characterAliasKeys(gchar);
        if ([...gKeys].some((k) => sessionIncomplete.has(k))) continue;
        {
          const attire = !gchar.attire_locked && cleanText(overlay?.attire || "")
            ? overlay.attire
            : gchar.attire || "";
          const accessories = !gchar.accessories_locked && cleanText(overlay?.accessories || "")
            ? overlay.accessories
            : gchar.accessories || "";
          const attireChanged = attire !== (gchar.attire || "");
          const accChanged = accessories !== (gchar.accessories || "");
          if (overlay && (attireChanged || accChanged)) {
            merged.push({
              ...gchar,
              attire,
              accessories,
              aliases: gchar.aliases || overlay.aliases || [],
              tags: fullTags({ ...gchar, attire, accessories }),
              scope: GLOBAL_SCOPE,
            });
          } else merged.push(gchar);
        }
      }
      for (const schar of session) {
        const hit = resolveCharacter(schar.name, merged);
        if (hit && characterHasAppearance(schar)) continue;
        if (hit && !characterHasAppearance(schar)) {
          if (characterHasAppearance(hit)) continue;
          const idx = merged.findIndex((c) => resolveCharacter(schar.name, [c]));
          if (idx >= 0) merged[idx] = schar;
          else merged.push(schar);
          continue;
        }
        if (hit) continue;
        merged.push(schar);
      }
      return merged;
    }

    async upsertCharacter(scope, raw) {
      const appearanceProvided = !!(raw && Object.prototype.hasOwnProperty.call(raw, "appearance"));
      const attireProvided = !!(raw && Object.prototype.hasOwnProperty.call(raw, "attire"));
      const accessoriesProvided = !!(raw && Object.prototype.hasOwnProperty.call(raw, "accessories"));
      const originalProvided = !!(raw && Object.prototype.hasOwnProperty.call(raw, "original"));
      const surnameProvided = !!(raw && Object.prototype.hasOwnProperty.call(raw, "surname"));
      const givenProvided = !!(raw && Object.prototype.hasOwnProperty.call(raw, "given_name"));
      const surnameVariantsProvided = !!(raw && Object.prototype.hasOwnProperty.call(raw, "surname_variants"));
      const givenVariantsProvided = !!(raw && Object.prototype.hasOwnProperty.call(raw, "given_name_variants"));
      let rec = normalizeCharacterRecord(raw);
      if (!rec) return null;
      scope = cleanText(scope, 200) || GLOBAL_SCOPE;
      const existingList = await this.listCharacters(scope);
      const selfId = cleanText(rec.id, 80);
      const dup = existingList.find((c) => {
        if (selfId && cleanText(c.id, 80) === selfId) return false;
        return Boolean(resolveCharacter(rec.name, [c]) || (rec.aliases || []).some((a) => resolveCharacter(a, [c])));
      });
      if (dup) {
        const aliases = parseAliasList([...(dup.aliases || []), ...(rec.aliases || []), rec.name, dup.name]);
        const nextAppearance = cleanText(rec.appearance || "", 4000);
        const nextAttire = cleanText(rec.attire || "", 4000);
        const nextAccessories = cleanText(rec.accessories || "", 4000);
        const nextOriginal = cleanText(rec.original || "", 400);
        const nextSurname = cleanText(rec.surname || "", 200);
        const nextGiven = cleanText(rec.given_name || "", 200);
        rec = normalizeCharacterRecord({
          ...dup,
          ...rec,
          id: dup.id,
          name: dup.name || rec.name,
          aliases,
          // Allow intentional clear from UI/modal saves (empty string). Only fall back
          // to the previous value when the field was omitted from the payload.
          original: originalProvided ? nextOriginal : nextOriginal || dup.original || "",
          appearance: appearanceProvided ? nextAppearance : nextAppearance || dup.appearance || "",
          attire: dup.attire_locked
            ? dup.attire || ""
            : attireProvided
              ? nextAttire
              : nextAttire || dup.attire || "",
          accessories: dup.accessories_locked
            ? dup.accessories || ""
            : accessoriesProvided
              ? nextAccessories
              : nextAccessories || dup.accessories || "",
          surname: surnameProvided ? nextSurname : nextSurname || dup.surname || "",
          given_name: givenProvided ? nextGiven : nextGiven || dup.given_name || "",
          surname_variants: surnameVariantsProvided
            ? parseAliasList([...(rec.surname_variants || []), nextSurname])
            : parseAliasList([...(dup.surname_variants || []), ...(rec.surname_variants || []), nextSurname, dup.surname]),
          given_name_variants: givenVariantsProvided
            ? parseAliasList([...(rec.given_name_variants || []), nextGiven])
            : parseAliasList([...(dup.given_name_variants || []), ...(rec.given_name_variants || []), nextGiven, dup.given_name]),
          attire_locked: dup.attire_locked === true || rec.attire_locked === true,
          accessories_locked: dup.accessories_locked === true || rec.accessories_locked === true,
          priority: Math.max(Number(dup.priority || 0), Number(rec.priority || 0)),
        });
        if (!rec) return null;
      }
      const now = Date.now() / 1000;
      await idbPut("characters", {
        scope,
        id: rec.id,
        name: rec.name,
        aliases: rec.aliases,
        surname: rec.surname || "",
        given_name: rec.given_name || "",
        surname_variants: rec.surname_variants || [],
        given_name_variants: rec.given_name_variants || [],
        priority: Number(rec.priority || 0),
        attire_locked: rec.attire_locked === true,
        accessories_locked: rec.accessories_locked === true,
        schema_version: 2,
        appearance: rec.appearance,
        attire: rec.attire,
        accessories: rec.accessories || "",
        original: rec.original || "",
        updated_at: now,
      });
      if (scope !== GLOBAL_SCOPE) {
        const appKey = `appearance:${scope}`;
        const existing = (await idbGet("meta", appKey))?.value || {};
        const tags = fullTags(rec);
        if (tags) existing[rec.name] = tags;
        else delete existing[rec.name];
        await idbPut("meta", { key: appKey, value: existing, updated_at: now });
      } else if (attireProvided || accessoriesProvided) {
        // Global wear edits must win over stale session overlays (LLM re-injects accessories).
        await this.clearSessionWearOverlaysFor(rec, {
          clearAttire: attireProvided,
          clearAccessories: accessoriesProvided,
        });
      }
      return rec;
    }

    /**
     * Drop attire/accessories on appearance-empty session rows that match a global character.
     * Those rows are wardrobe overlays and otherwise keep shadowing a manual global clear
     * (e.g. removing "airpods in one ear" from global while a chat overlay still has it).
     */
    async clearSessionWearOverlaysFor(globalRec, { clearAttire = true, clearAccessories = true } = {}) {
      if (!globalRec || (!clearAttire && !clearAccessories)) return 0;
      const match = (row) => {
        if (!row || row.scope === GLOBAL_SCOPE) return false;
        if (characterHasAppearance(row)) return false;
        const helper = globalThis.__INLAY_IDENTITY__?.characterMatchesIdentity;
        if (typeof helper === "function") return !!helper(row, globalRec);
        return Boolean(
          resolveCharacter(globalRec.name, [row])
          || (globalRec.aliases || []).some((a) => resolveCharacter(a, [row])),
        );
      };
      let changed = 0;
      try {
        const rows = typeof idbGetAll === "function" ? await idbGetAll("characters") : [];
        for (const row of rows || []) {
          if (!match(row)) continue;
          const nextAttire = clearAttire ? "" : (row.attire || "");
          const nextAcc = clearAccessories ? "" : (row.accessories || "");
          if ((row.attire || "") === nextAttire && (row.accessories || "") === nextAcc) continue;
          await idbPut("characters", {
            ...row,
            attire: nextAttire,
            accessories: nextAcc,
            updated_at: Date.now() / 1000,
          });
          changed += 1;
        }
      } catch {
      }
      return changed;
    }

    async deleteCharacter(scope, id) {
      scope = cleanText(scope, 200) || GLOBAL_SCOPE;
      id = cleanText(id, 80);
      if (!id) return false;
      const row = await idbGet("characters", { scope, id });
      await idbDelete("characters", { scope, id });
      if (scope !== GLOBAL_SCOPE && row?.name) {
        const appKey = `appearance:${scope}`;
        const existing = { ...((await idbGet("meta", appKey))?.value || {}) };
        delete existing[row.name];
        await idbPut("meta", { key: appKey, value: existing, updated_at: Date.now() / 1000 });
      }
      return true;
    }

    characterMatchesDeleteRef(char, ref) {
      const helper = globalThis.__INLAY_IDENTITY__?.characterMatchesIdentity;
      if (typeof helper === "function") return !!helper(char, ref);
      const cid = cleanText(char?.id, 80);
      const rid = cleanText(ref?.id, 80);
      if (cid && rid && cid === rid) return true;
      const cName = cleanText(char?.name, 200);
      const rName = cleanText(ref?.name, 200);
      if (cName && rName && normalizeAlias(cName) === normalizeAlias(rName)) return true;
      return false;
    }

    /**
     * Delete matching roster rows from root chat sessions (unified view delete → roots).
     * Never creates rows.
     */
    async deleteMatchingInSessions(sessionIds, deletedRefs, skipSessionId = "") {
      const refs = (Array.isArray(deletedRefs) ? deletedRefs : []).filter((r) => r && (r.id || r.name));
      if (!refs.length) return { deleted: 0, sessions: 0 };
      const skip = cleanText(skipSessionId, 200);
      const seen = new Set();
      let deleted = 0;
      let sessions = 0;
      for (const rawSid of sessionIds || []) {
        const sid = cleanText(rawSid, 200);
        if (!sid || sid === skip || sid === GLOBAL_SCOPE || seen.has(sid)) continue;
        seen.add(sid);
        const list = await this.listCharacters(sid);
        let hit = false;
        for (const char of list) {
          if (!refs.some((ref) => this.characterMatchesDeleteRef(char, ref))) continue;
          await this.deleteCharacter(sid, char.id);
          deleted += 1;
          hit = true;
        }
        if (hit) sessions += 1;
      }
      return { deleted, sessions };
    }

    /**
     * Patch appearance/identity onto root chats that already have the character.
     * Does not create rows where the identity is missing.
     */
    async patchExistingInSessions(sessionIds, characters, skipSessionId = "") {
      const rows = (Array.isArray(characters) ? characters : []).filter((c) => c && (c.id || c.name));
      if (!rows.length) return { updated: 0, sessions: 0 };
      const skip = cleanText(skipSessionId, 200);
      const seen = new Set();
      let updated = 0;
      let sessions = 0;
      for (const rawSid of sessionIds || []) {
        const sid = cleanText(rawSid, 200);
        if (!sid || sid === skip || sid === GLOBAL_SCOPE || seen.has(sid)) continue;
        seen.add(sid);
        const list = await this.listCharacters(sid);
        let hit = false;
        for (const raw of rows) {
          const existing = resolveCharacter(raw.name, list)
            || (Array.isArray(raw.aliases) ? raw.aliases.map((a) => resolveCharacter(a, list)).find(Boolean) : null)
            || (cleanText(raw.id, 80) ? list.find((c) => cleanText(c.id, 80) === cleanText(raw.id, 80)) : null);
          if (!existing) continue;
          const rec = await this.upsertCharacter(sid, {
            ...raw,
            id: existing.id,
            name: existing.name || raw.name,
            appearance: raw.appearance != null ? raw.appearance : "",
            attire: raw.attire != null ? raw.attire : "",
            accessories: raw.accessories != null ? raw.accessories : "",
            original: raw.original != null ? raw.original : "",
          });
          if (rec) {
            updated += 1;
            hit = true;
          }
        }
        if (hit) sessions += 1;
      }
      return { updated, sessions };
    }

    async replaceCharacters(scope, characters, opts = {}) {
      scope = cleanText(scope, 200) || GLOBAL_SCOPE;
      // Default upsert-only (jobs / appearance patches). UI save passes prune:true
      // so removed roster rows are actually deleted from the scope.
      const prune = opts.prune === true;
      const rootSessionIds = Array.isArray(opts.rootSessionIds) ? opts.rootSessionIds : [];
      const merged = mergeCharactersByAlias(characters || []);
      // Unified view: write only to existing root chat rows (no create, no __unified__ authority).
      if (rootSessionIds.length) {
        if (prune) {
          const keepKeys = new Set();
          for (const raw of merged) {
            for (const key of _characterAliasKeys(raw)) keepKeys.add(key);
            const nk = normalizeAlias(raw.name);
            if (nk) keepKeys.add(nk);
          }
          for (const sid of rootSessionIds) {
            const sidClean = cleanText(sid, 200);
            if (!sidClean || sidClean === GLOBAL_SCOPE) continue;
            for (const old of await this.listCharacters(sidClean)) {
              const keys = [..._characterAliasKeys(old)];
              const nameKey = normalizeAlias(old.name);
              if (nameKey) keys.push(nameKey);
              if (keys.some((k) => keepKeys.has(k))) continue;
              await this.deleteCharacter(sidClean, old.id);
            }
          }
        }
        if (merged.length) await this.patchExistingInSessions(rootSessionIds, merged, "");
        return merged.map((c) => normalizeCharacterRecord(c)).filter(Boolean);
      }
      const out = [];
      for (const raw of merged) {
        const rec = await this.upsertCharacter(scope, raw);
        if (rec) out.push(rec);
      }
      if (prune) {
        const keep = new Set(out.map((c) => cleanText(c.id, 80)).filter(Boolean));
        for (const old of await this.listCharacters(scope)) {
          const oid = cleanText(old.id, 80);
          if (oid && !keep.has(oid)) await this.deleteCharacter(scope, oid);
        }
      }
      return out;
    }

    async getCharactersPayload(sessionId, characterId = "") {
      sessionId = cleanText(sessionId, 200);
      characterId = cleanText(characterId, 200);
      const session = sessionId ? await this.listCharacters(sessionId) : [];
      const disabled = characterId ? await this.getDisabledGlobalsSet(characterId) : new Set();
      const globalChars = [];
      for (const char of await this.listCharacters(GLOBAL_SCOPE)) {
        const item = { ...char };
        item.enabled_for_character = characterId ? !this._globalToggleKeyDisabled(char, disabled) : true;
        globalChars.push(item);
      }
      const appearance = Object.fromEntries(session.map((c) => [c.name, fullTags(c)]));
      return {
        ok: true,
        session_id: sessionId,
        character_id: characterId,
        characters: session,
        global: globalChars,
        appearance,
        disabled_globals: [...disabled].sort(),
        global_enabled: characterId ? await this.globalEnabledMap(characterId) : {},
      };
    }

    async unifyCharacterSessions(targetSessionId, sourceSessionIds, includeTarget = true) {
      targetSessionId = cleanText(targetSessionId, 200);
      if (!targetSessionId) return { ok: false, error: { code: "bad_request", message: "target_session_id required" } };
      const collected = [];
      const seenScopes = new Set();
      for (const sid of sourceSessionIds || []) {
        const scope = cleanText(sid, 200);
        if (!scope || seenScopes.has(scope)) continue;
        seenScopes.add(scope);
        collected.push(...(await this.listCharacters(scope)));
      }
      if (includeTarget && !seenScopes.has(targetSessionId)) collected.push(...(await this.listCharacters(targetSessionId)));
      const merged = mergeCharactersByAlias(collected);
      const saved = [];
      for (const raw of merged) {
        const existing = resolveCharacter(raw.name, await this.listCharacters(targetSessionId));
        const rec = await this.upsertCharacter(targetSessionId, {
          ...raw,
          id: existing?.id || raw.id,
          priority: Math.max(Number(existing?.priority || 0), Number(raw.priority || 0)),
        });
        if (rec) saved.push(rec);
      }
      const payload = await this.getCharactersPayload(targetSessionId);
      return { ...payload, ok: true, merged: saved.length, sources: [...seenScopes] };
    }

    async getAppearance(sessionId) {
      return Object.fromEntries((await this.listCharacters(sessionId)).map((c) => [c.name, fullTags(c)]));
    }

    async setAppearance(sessionId, mapping) {
      const chars = Object.entries(mapping || {}).map(([name, tags]) => ({ name, tags }));
      await this.replaceCharacters(sessionId, chars);
      return { ok: true, appearance: await this.getAppearance(sessionId) };
    }

    async mergeRosterFromTagged(sessionId, tagged, shotChars, unifiedSessionId = "", characterId = "", sourceSessionIds = []) {
      characterId = cleanText(characterId || "", 200);
      // Autotag / new chars always land on the live chat — never the unified cache.
      const writeSessionId = cleanText(sessionId || "", 200);
      let roster = await this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
      const newList = [...(tagged.new_characters || [])];
      const covered = new Set(newList.map((raw) => normalizeAlias(raw?.name)));
      const namePartsFrom = (rec, existing = null) => ({
        surname: cleanText(rec?.surname || existing?.surname || "", 200),
        given_name: cleanText(rec?.given_name || existing?.given_name || "", 200),
        surname_variants: parseAliasList([
          ...(existing?.surname_variants || []),
          ...(rec?.surname_variants || []),
          rec?.surname,
          existing?.surname,
        ]),
        given_name_variants: parseAliasList([
          ...(existing?.given_name_variants || []),
          ...(rec?.given_name_variants || []),
          rec?.given_name,
          existing?.given_name,
        ]),
      });
      for (const char of shotChars || []) {
        const name = cleanText(char.name, 200);
        if (!name || covered.has(normalizeAlias(name))) continue;
        const existing = resolveCharacter(name, roster);
        if (existing && characterHasAppearance(existing)) continue;
        newList.push({
          name: existing?.name || name,
          aliases: parseAliasList(char.aliases) || existing?.aliases || [name],
          original: cleanText(char.original || char.original_tag || existing?.original || "", 400),
          appearance: joinTags(char.label, char.age, char.appearance, char.body),
          attire: cleanText(char.attire || existing?.attire || ""),
          accessories: cleanText(char.accessories || existing?.accessories || ""),
          ...namePartsFrom(char, existing),
        });
        covered.add(normalizeAlias(name));
      }
      if (typeof tagged === "object") tagged.new_characters = newList;

      for (const raw of newList) {
        const rec = normalizeCharacterRecord(raw);
        if (!rec) continue;
        const existing = resolveCharacter(rec.name, roster);
        const newApp = cleanText(rec.appearance || "");
        const newAttire = cleanText(rec.attire || "");
        const newAccessories = cleanText(rec.accessories || "");
        const nameParts = namePartsFrom(rec, existing);

        if (existing?.scope === GLOBAL_SCOPE && characterHasAppearance(existing)) {
          const canAttire = newAttire && !existing.attire_locked;
          const canAcc = newAccessories && !existing.accessories_locked;
          if (canAttire || canAcc) {
            let appearance = existing.appearance || "";
            let attire = existing.attire || "";
            let accessories = existing.accessories || "";
            if (canAttire) [appearance, attire, accessories] = replaceAttire(appearance, attire, accessories, newAttire);
            if (canAcc) [appearance, attire, accessories] = replaceAccessories(appearance, attire, accessories, newAccessories);
            await this.upsertCharacter(writeSessionId, {
              id: existing.id || rec.id,
              name: existing.name || rec.name,
              aliases: existing.aliases || rec.aliases,
              original: "",
              appearance: "",
              attire,
              accessories,
              ...nameParts,
            });
          }
          roster = await this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
          continue;
        }

        if (existing && !characterHasAppearance(existing)) {
          const writeScope = existing.scope === GLOBAL_SCOPE ? GLOBAL_SCOPE : (existing.scope || writeSessionId);
          let aliases = parseAliasList([...(existing.aliases || []), ...(rec.aliases || [])]);
          let appearance = newApp || existing.appearance || "";
          let attire = existing.attire || "";
          let accessories = existing.accessories || "";
          const original = existing.original || rec.original || "";
          if (!existing.attire_locked && newAttire) [appearance, attire, accessories] = replaceAttire(appearance, attire, accessories, newAttire);
          else if (!existing.attire_locked && rec.attire) [appearance, attire, accessories] = replaceAttire(appearance, attire, accessories, rec.attire);
          if (!existing.accessories_locked && newAccessories) {
            [appearance, attire, accessories] = replaceAccessories(appearance, attire, accessories, newAccessories);
          } else if (!existing.accessories_locked && rec.accessories) {
            [appearance, attire, accessories] = replaceAccessories(appearance, attire, accessories, rec.accessories);
          }
          await this.upsertCharacter(writeScope, {
            id: existing.id || rec.id,
            name: existing.name || rec.name,
            aliases: aliases.length ? aliases : existing.aliases || rec.aliases,
            original,
            appearance,
            attire,
            accessories,
            attire_locked: existing.attire_locked === true,
            accessories_locked: existing.accessories_locked === true,
            ...nameParts,
          });
          roster = await this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
          continue;
        }

        if (existing && existing.scope !== GLOBAL_SCOPE) {
          let aliases = parseAliasList([...(existing.aliases || []), ...(rec.aliases || [])]);
          let appearance = existing.appearance || rec.appearance || "";
          let attire = existing.attire || "";
          let accessories = existing.accessories || "";
          let original = existing.original || rec.original || "";
          if (rec.appearance && !existing.appearance) appearance = rec.appearance;
          if (rec.original && !existing.original) original = rec.original;
          if (!existing.attire_locked && rec.attire) [appearance, attire, accessories] = replaceAttire(appearance, attire, accessories, rec.attire);
          if (!existing.accessories_locked && rec.accessories) {
            [appearance, attire, accessories] = replaceAccessories(appearance, attire, accessories, rec.accessories);
          }
          await this.upsertCharacter(writeSessionId, {
            id: existing.id || rec.id,
            name: existing.name || rec.name,
            aliases,
            original,
            appearance,
            attire,
            accessories,
            attire_locked: existing.attire_locked === true,
            accessories_locked: existing.accessories_locked === true,
            ...nameParts,
          });
        } else if (!existing) {
          await this.upsertCharacter(writeSessionId, rec);
        }
        roster = await this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
      }

      for (const char of shotChars || []) {
        const name = cleanText(char.name, 200);
        if (!name) continue;
        const existing = resolveCharacter(name, roster);
        const newAttire = cleanText(char.attire || "");
        const newAccessories = cleanText(char.accessories || "");
        const legacyApp = cleanText(char.appearance || "");
        if (existing?.scope === GLOBAL_SCOPE) {
          const canAttire = !existing.attire_locked;
          const canAcc = !existing.accessories_locked;
          if (!canAttire && !canAcc) {
            roster = await this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
            continue;
          }
          let attire = existing.attire || "";
          let accessories = existing.accessories || "";
          let appearance = existing.appearance || "";
          let changed = false;
          if (canAttire && newAttire) {
            [appearance, attire, accessories] = replaceAttire(appearance, attire, accessories, newAttire);
            changed = true;
          } else if (canAttire && legacyApp) {
            const [, clothing] = splitLookTags(legacyApp);
            if (clothing) {
              [appearance, attire, accessories] = replaceAttire(appearance, attire, accessories, clothing);
              changed = true;
            }
          }
          if (canAcc && newAccessories) {
            [appearance, attire, accessories] = replaceAccessories(appearance, attire, accessories, newAccessories);
            changed = true;
          } else if (canAcc && legacyApp) {
            const [, , acc] = splitLookTags(legacyApp);
            if (acc) {
              [appearance, attire, accessories] = replaceAccessories(appearance, attire, accessories, acc);
              changed = true;
            }
          }
          if (!changed) {
            roster = await this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
            continue;
          }
          await this.upsertCharacter(writeSessionId, {
            id: existing.id,
            name: existing.name,
            aliases: existing.aliases,
            original: "",
            appearance: "",
            attire,
            accessories,
          });
        } else if (existing) {
          let appearance = existing.appearance || "";
          let attire = existing.attire || "";
          let accessories = existing.accessories || "";
          const aliases = parseAliasList([...(existing.aliases || []), ...parseAliasList(char.aliases)]);
          if (!existing.attire_locked && newAttire) [appearance, attire, accessories] = replaceAttire(appearance, attire, accessories, newAttire);
          else if (!existing.attire_locked && legacyApp) {
            const [, clothing] = splitLookTags(legacyApp);
            if (clothing) [appearance, attire, accessories] = replaceAttire(appearance, attire, accessories, clothing);
          }
          if (!existing.accessories_locked && newAccessories) {
            [appearance, attire, accessories] = replaceAccessories(appearance, attire, accessories, newAccessories);
          } else if (!existing.accessories_locked && legacyApp) {
            const [, , acc] = splitLookTags(legacyApp);
            if (acc) [appearance, attire, accessories] = replaceAccessories(appearance, attire, accessories, acc);
          }
          await this.upsertCharacter(existing.scope === GLOBAL_SCOPE ? GLOBAL_SCOPE : (existing.scope || writeSessionId), {
            id: existing.id,
            name: existing.name,
            aliases: aliases.length ? aliases : existing.aliases,
            original: existing.original || cleanText(char.original || "", 400),
            appearance: appearance || existing.appearance,
            attire,
            accessories,
            attire_locked: existing.attire_locked === true,
            accessories_locked: existing.accessories_locked === true,
          });
        } else {
          const appearance = joinTags(char.label, char.age, char.appearance || "", char.body || "");
          const attire = cleanText(char.attire || "");
          const accessories = cleanText(char.accessories || "");
          const [identity, splitAttire, splitAcc] = splitLookTags(joinTags(appearance, attire, accessories));
          await this.upsertCharacter(writeSessionId, {
            name,
            aliases: parseAliasList(char.aliases) || [name],
            original: cleanText(char.original || char.original_tag || "", 400),
            appearance: identity,
            attire: splitAttire,
            accessories: splitAcc,
          });
        }
        roster = await this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
      }
      return this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
    }

    async callLlm(messages) {
      const llm = this.config.llm || {};
      const source = normalizeLlmSource(llm.source);
      if (source === "main" || source === "aux") {
        // Do NOT pass the custom Model field as staticModel — that overrides Risu's
        // configured main/aux model with a leftover OpenRouter/etc id and skips the real request.
        return this.callLlmViaRisu(messages, source);
      }
      const H = llmHelpers();
      const provider = H.normalizeLlmProvider?.(llm.provider) || normalizeLlmProviderFallback(llm.provider);
      const model = cleanText(llm.model);
      const region = cleanText(llm.vertex_region) || "us-central1";
      let apiKey = cleanText(llm.api_key);
      let projectId = "";
      if (provider === "vertex" && cleanText(llm.service_account_json)) {
        const tok = await googleAccessTokenFromServiceAccount(llm.service_account_json);
        apiKey = tok.accessToken;
        projectId = tok.projectId;
      }
      if (!model || !apiKey) {
        dbg("llm.config", { message: "missing model/api_key", provider }, "error");
        throw new Error(
          provider === "vertex"
            ? "Vertex AI: Model + Service Account JSON(또는 access token)이 필요합니다."
            : "태깅 LLM이 설정되지 않았습니다. 모델 설정에서 Provider·Model·API key를 넣으세요. (NovelAI 키와 별개)",
        );
      }
      const endpoint = H.ensureLlmRequestUrl?.(
        cleanText(llm.endpoint),
        provider,
        { region, projectId },
      ) || cleanText(llm.endpoint) || "https://api.openai.com/v1/chat/completions";
      if (provider === "vertex" && !/\/chat\/completions$/i.test(endpoint)) {
        throw new Error("Vertex AI: project_id가 있는 Service Account JSON이 필요합니다. (OpenAI-compatible endpoint 구성용)");
      }
      const timeoutMs = Number(llm.timeout_seconds ?? 180) * 1000;
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => {
        dbg("llm.abort", { message: `timeout ${timeoutMs}ms`, model, provider }, "warn");
        controller?.abort?.();
      }, timeoutMs);
      const span = dbgSpan("llm.call");
      dbg("llm.call.start", {
        message: model,
        msgs: messages?.length || 0,
        timeout_ms: timeoutMs,
        source,
        provider,
        reasoning: cleanText(llm.reasoning_effort) || "default",
      });
      try {
        let resp;
        if (provider === "anthropic_compatible") {
          const converted = openaiMessagesToAnthropic(messages);
          const body = {
            model,
            max_tokens: Number(llm.max_tokens ?? 8000),
            temperature: Math.min(1, Number(llm.temperature ?? 0.4)),
            messages: converted.messages,
          };
          if (converted.system) body.system = converted.system;
          resp = await networkFetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": cleanText(llm.anthropic_version) || "2023-06-01",
            },
            body: JSON.stringify(body),
            signal: controller?.signal,
          });
        } else {
          let body = {
            model,
            messages,
            temperature: Number(llm.temperature ?? 0.4),
            max_tokens: Number(llm.max_tokens ?? 8000),
          };
          body = H.applyReasoningToBody?.(body, llm.reasoning_effort) || body;
          const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          };
          if (provider === "openrouter") {
            headers["HTTP-Referer"] = "https://risuai.xyz";
            headers["X-Title"] = "Inlay Nexus";
          }
          resp = await networkFetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller?.signal,
          });
        }
        const status = Number(resp?.status || 0);
        let payload;
        try {
          payload = await resp.json();
        } catch (_) {
          payload = {};
        }
        if (status >= 400) {
          span.fail(new Error(`HTTP ${status}`), { status, body: JSON.stringify(payload).slice(0, 200), provider });
          throw new Error(`LLM HTTP ${status}: ${JSON.stringify(payload).slice(0, 500)}`);
        }
        const text = provider === "anthropic_compatible"
          ? extractAnthropicText(payload)
          : extractChatCompletionText(payload);
        span.end({ message: model, status, bytes: text.length, provider });
        return text;
      } catch (err) {
        span.fail(err, { model, provider });
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    async callLlmViaRisu(messages, source, staticModel = "") {
      const api = globalThis.risuai || globalThis.Risuai;
      if (!api || typeof api.runLLMModel !== "function") {
        throw new Error("RisuAI runLLMModel API를 사용할 수 없습니다. Risu를 최신으로 업데이트하세요.");
      }
      // Risu ModelModeExtended: 'model' | 'submodel' | 'memory' | 'emotion' | 'otherAx' | 'translate'
      // "main" is NOT valid — anything other than "model" falls through to db.subModel.
      const mode = source === "main" ? "model" : "otherAx";
      const llm = this.config.llm || {};
      const timeoutMs = Math.max(5000, Number(llm.timeout_seconds ?? 180) * 1000);
      // Only honor an explicit override; never the custom-endpoint Model text box.
      const staticOverride = cleanText(staticModel) || "";
      const span = dbgSpan("llm.call");
      dbg("llm.call.start", {
        message: `risu:${mode}`,
        msgs: messages?.length || 0,
        timeout_ms: timeoutMs,
        source,
        static_model: staticOverride,
      });
      let timer = null;
      try {
        const response = await Promise.race([
          api.runLLMModel({
            mode,
            ...(staticOverride ? { staticModel: staticOverride } : {}),
            allowPlugins: true,
            messages,
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Risu LLM timeout ${timeoutMs}ms (${mode})`)), timeoutMs);
          }),
        ]);
        const text = cleanText(await llmResponseToText(response));
        if (!text) throw new Error(`Risu LLM(${mode}) 응답이 비어 있습니다.`);
        span.end({ message: `risu:${mode}`, bytes: text.length });
        return text;
      } catch (err) {
        span.fail(err, { mode });
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async buildTaggerMessages(request) {
      const card = deepMerge(this.config.card || {}, request.card || {});
      const sessionId = cleanText(request.session_id, 200);
      const tagger = stripCbs(await this.getPrompt("tagger"));
      const fmt = stripCbs(await this.getPrompt("format"));
      const messages = [{ role: "system", content: `${tagger}\n\n${fmt}`.trim() }];

      if (card.char_info && cleanText(request.character_description)) {
        messages.push({
          role: "system",
          content: `${await this.getPrompt("char_inject")}\n## {{char}} Info\n${cleanText(request.character_description, 12000)}`,
        });
      }
      if (card.user_info && cleanText(request.persona_description)) {
        messages.push({
          role: "system",
          content: `${await this.getPrompt("char_inject")}\n## {{user}} Info\n${cleanText(request.persona_description, 8000)}`,
        });
      }

      const assistant = cleanText(request.assistant_text, 20000);
      const sourceSessionIds = Array.isArray(request.source_session_ids)
        ? request.source_session_ids.map((s) => cleanText(s, 200)).filter(Boolean)
        : [];
      const rosterEarly = card.lorebook || card.char_appearance !== false
        ? await this.rosterForSession(
          sessionId,
          cleanText(request.unified_session_id || "", 200),
          cleanText(request.character_id || "", 200),
          sourceSessionIds,
        )
        : [];
      const filledNames = filledNamesForLoreExtra(rosterEarly);

      if (card.lorebook) {
        const triggerKeys = Array.isArray(request.lore_trigger_keys) ? request.lore_trigger_keys : null;
        const loreExtraMode = normalizeLoreExtraMode(card.lore_extra);
        const filtered = assembleLorebookForTagger(
          request.lorebook || [],
          assistant,
          filledNames,
          5,
          1200,
          triggerKeys,
          loreExtraMode,
        );
        const extraBlocks = [];
        const refBlocks = [];
        for (const entry of filtered) {
          const isExtra = isCharacterImageExtraLore(entry) || entry.always;
          const content = cleanText(entry.content || "", isExtra ? 50000 : 1200);
          if (!content) continue;
          const comment = cleanText(entry.comment || "", 200);
          const block = comment ? `### ${comment}\n${content}` : content;
          if (isExtra) extraBlocks.push(block);
          else refBlocks.push(block);
        }
        const loreParts = [];
        if (extraBlocks.length) {
          loreParts.push(
            "## lb-xnai.lb.extra — OFFICIAL PACK (START)\n"
            + "Everything until OFFICIAL PACK (END) is the lb-xnai pack only (custom prompt + Character Image Tags). "
            + "Headings like `### Character Name` inside this region are pack sections, NOT separate lore entries.\n\n"
            + extraBlocks.join("\n\n")
            + "\n\n## lb-xnai.lb.extra — OFFICIAL PACK (END)\n"
            + "[END OF lb-xnai.lb.extra] The official pack above is finished. "
            + "Do NOT treat any heading or text below as lb-xnai image-tag ground truth.",
          );
        }
        if (refBlocks.length) {
          loreParts.push(
            "## Reference Lorebook (trigger-matched only)\n"
            + "From here down: ordinary matched lore for naming/context only. "
            + "Not part of lb-xnai.lb.extra. Do not copy lore prose into appearance/attire/accessories tags.\n\n"
            + refBlocks.join("\n\n"),
          );
        }
        dbg("job.lore.extra", {
          trigger_keys: Array.isArray(triggerKeys) ? triggerKeys.length : 0,
          injected: extraBlocks.length,
          reference: refBlocks.length,
          sections: filtered
            .filter((e) => isCharacterImageExtraLore(e) || e.always)
            .map((e) => e.key || "")
            .filter(Boolean)
            .join(" | "),
        });
        if (loreParts.length) {
          messages.push({ role: "system", content: `${await this.getPrompt("lore_inject")}\n${loreParts.join("\n\n")}` });
        }
      }

      if (card.char_appearance !== false) {
        const roster = rosterEarly;
        const filled = roster.filter((c) => characterHasAppearance(c));
        const incomplete = roster.filter((c) => cleanText(c.name, 200) && !characterHasAppearance(c));
        const matched = matchCharactersInText(assistant, roster);
        if (filled.length || incomplete.length || matched.length) {
          const registeredBlock = filled.length
            ? filled
                .map((c) => {
                  const name = cleanText(c.name, 200);
                  const preview = cleanText(c.appearance || "", 120);
                  return preview ? `${name} ← ${preview}` : name;
                })
                .filter(Boolean)
                .join("\n")
            : "(없음)";
          const incompleteBlock = incomplete.length
            ? incomplete
                .map((char) => `- ${char.name} (별칭: ${characterTriggers(char).slice(0, 8).join(", ")}) → appearance 비어 있음, new_characters에 상세 외형 필수`)
                .join("\n")
            : "(없음)";
          const detectedBlock = matched.length
            ? matched
                .map((char) => `- ${char.name} [${characterHasAppearance(char) ? "외형OK" : "외형미완성"}] (별칭: ${characterTriggers(char).slice(0, 8).join(", ")})`)
                .join("\n")
            : "(이번 메시지에서 등록 캐릭터 트리거 미검출 — 전부 신규일 수 있음)";
          let content = await this.getPrompt("appearance_inject");
          content = content.includes("{registered_block}") ? content.replace("{registered_block}", registeredBlock) : `${content}\n\n${registeredBlock}`;
          content = content.includes("{incomplete_block}") ? content.replace("{incomplete_block}", incompleteBlock) : `${content}\n\n## 외형 미완성\n${incompleteBlock}`;
          content = content.includes("{detected_block}") ? content.replace("{detected_block}", detectedBlock) : `${content}\n\n${detectedBlock}`;
          messages.push({ role: "system", content });
          dbg("job.roster.split", {
            filled: filled.map((c) => c.name),
            incomplete: incomplete.map((c) => c.name),
            matched: matched.map((c) => c.name),
            session_id: sessionId,
          });
        }
      }

      // Always ask for y_percent so values are saved. Toggle only affects display (equal bands vs LLM %).
      messages.push({
        role: "system",
        content:
          "Every shot MUST include `y_percent` (number 0–100): reading position top→bottom in the message. CRITICAL spread rule: NEVER cluster all shots in the early band. Space them across the whole 0–100 range in reading order (shot0 < shot1 < shot2 …). Aim ~even gaps. Examples — 2 shots: ~25 and ~75; 3 shots: ~20, ~50, ~80; 4 shots: ~15, ~40, ~65, ~90. Forbidden: all values under 40, duplicates, or gaps under ~15 between neighbors unless only 1 shot.",
      });

      if (card.natural_base !== false) {
        messages.push({
          role: "system",
          content:
            "Natural base mode ON. Every shot MUST include `natural`: a short English natural-language phrase for NovelAI base caption only (NOT Danbooru comma tags, NOT characters[].action). Include hair color + age band + gender for each visible person, plus the shared action. Example: `red hair adult woman forced hug blue hair boy`. Keep ~6–20 words, English only.",
        });
      } else {
        messages.push({
          role: "system",
          content: "Natural base mode OFF. Omit the `natural` field (or leave it empty). Do not invent natural-language base phrases.",
        });
      }

      const charMax = characterMaxLimit(card);
      messages.push({
        role: "system",
        content: `CHARACTER CAP: each shot may include at most ${charMax} characters (char1..char${charMax} only). Never list more than ${charMax} entries in \`characters[]\`. If more people are visible, keep the ${charMax} most important and fold extras into situation/place tags.`,
      });

      const chunks = [];
      const includeMax = Number(card.include_max || 0);
      if (includeMax > 0) {
        for (const msg of request.recent_messages || []) {
          const role = cleanText(msg?.role, 40) || "char";
          const body = cleanText(msg?.content || msg?.data, 12000);
          if (!body) continue;
          if (assistant && body === assistant && ["char", "assistant", "bot"].includes(role.toLowerCase())) continue;
          chunks.push(`[${role}]\n${body}`);
        }
      }
      if (assistant) chunks.push(assistant);
      const userContent = chunks.length ? chunks.join("\n\n") : assistant;
      if (!userContent) throw new Error("태깅할 메시지 텍스트가 없습니다.");
      messages.push({ role: "user", content: userContent });

      // User author's note — empty by default; when set, highest-priority override (like module CustomInst).
      const authorNote = cleanText(await this.getPrompt("author_note"), 8000);
      if (authorNote) {
        messages.push({
          role: "user",
          content:
            `# Priority: Author's Note\n${authorNote}\n` +
            "> These are instructions explicitly given by the user. If in conflict with previous instructions, this section MUST take precedence.",
        });
      }
      return messages;
    }

    flattenShots(tagged) {
      const charMax = characterMaxLimit(this.config.card || {});
      const shots = [];
      for (const scene of tagged.scenes || []) {
        const place = cleanText(scene.place);
        for (const shot of scene.shots || []) {
          const item = { ...shot, place, characters: dedupeShotCharacters(shot.characters || [], [], charMax).slice(0, charMax) };
          // roster not available yet — name-only dedupe; buildGenerationForShot will dedupe again with roster
          shots.push(item);
        }
      }
      return shots;
    }

    async buildGenerationForShot(shot, roster, opts = {}) {
      const card = this.config.card || {};
      const nai = this.config.nai || {};
      const charMax = characterMaxLimit(card);
      const chars = dedupeShotCharacters(shot.characters || [], roster, charMax).slice(0, charMax);
      const n = Math.max(1, chars.length);
      const personMode = normalizePersonTagMode(card.person_tag_mode, card.auto_person_tags);
      const person = personCountTagsForShot(chars, roster, personMode);
      const [filePos, fileNeg] = extractPreset(await this.getPrompt("preset_1"));
      const presets = Array.isArray(card.presets) ? card.presets : [];
      const activeId = cleanText(card.active_preset_id, 120);
      let active = null;
      if (presets.length) {
        if (activeId) active = presets.find((item) => typeof item === "object" && cleanText(item.id, 120) === activeId) || null;
        if (!active && typeof presets[0] === "object") active = presets[0];
      }
      let stylePos;
      let styleNeg;
      if (active) {
        stylePos = cleanText(active.positive || active.pos || "");
        styleNeg = cleanText(active.negative || active.neg || "");
      } else {
        stylePos = joinTags(cleanText(card.custom_pos), filePos);
        styleNeg = joinTags(cleanText(card.custom_neg), fileNeg);
      }
      let situation = shot.situation || shot.scene;
      if (personMode !== "off") situation = stripPersonCountTags(situation || "");
      let setup;
      const lockedSetup = cleanText(opts.lockedSetup || "");
      if (lockedSetup) {
        setup = lockedSetup;
      } else {
        setup = joinTags(shot.camera, situation, shot.place, shot.action);
        if (card.mode === "asset") setup = joinTags(setup, "white background", "simple background", "cowboy shot", "looking at viewer", "portrait");
      }
      // Natural-language base phrase (LLM shots[].natural) — only when setting enabled.
      const natural = card.natural_base !== false ? cleanText(shot.natural || shot.natural_base || shot.nl || "", 400) : "";
      let main = joinTags(person, stylePos, natural, setup);
      const naiaModel = modelToNaia(nai.model || "nai-diffusion-4-5-full");
      if (nai.apply_quality_tags !== false) main += QUALITY_TAGS[naiaModel] || "";
      const ucPreset = cleanText(nai.uc_preset) || "human_focus";
      const neg = joinTags(styleNeg, (UC_PRESETS[naiaModel] || {})[ucPreset] || "");

      const captions = [];
      const charMeta = [];
      for (let idx = 0; idx < chars.length; idx++) {
        const char = chars[idx];
        const name = cleanText(char.name, 200);
        const stored = name ? resolveCharacter(name, roster) : null;
        const hasLooks = characterHasAppearance(stored);
        const storedTags = stored && hasLooks ? fullTags(stored) : "";
        const shotOriginal = cleanText(char.original || char.original_tag || "", 400);
        const storedOriginal = cleanText(stored?.original || "", 400);
        const prompt = normalizeCharacterCaptionTags(
          joinTags(
            storedOriginal ? "" : shotOriginal,
            storedTags,
            hasLooks ? "" : char.label,
            hasLooks ? "" : char.age,
            hasLooks ? "" : char.appearance,
            hasLooks ? "" : char.body,
            hasLooks ? "" : char.attire || stored?.attire,
            hasLooks ? "" : char.accessories || stored?.accessories,
            char.expression,
            char.action,
            char.sex,
          ),
        );
        const uc = cleanText(char.negative);
        const cx = n === 1 ? 0.5 : Math.round((0.1 + (0.8 * idx) / Math.max(1, n - 1)) * 10) / 10;
        const cy = 0.5;
        captions.push({ prompt: prompt || "girl", uc, center_x: cx, center_y: cy });
        charMeta.push({ name: stored?.name || name, prompt, uc, center_x: cx, center_y: cy, raw: char });
      }
      return [main, neg, captions, { setup, person, characters: charMeta, paragraph: shot.paragraph }];
    }

    async generateImage(main, neg, captions) {
      const nai = this.config.nai || {};
      if (imageBackendKind(nai) === "comfy") {
        return generateViaComfy(nai, main, neg, captions);
      }
      const token = cleanText(nai.api_key);
      if (!token) throw new Error("NAI api_key가 설정되지 않았습니다.");
      const characterRefs = [];
      const refMode = cleanText(nai.image_reference || "none").toLowerCase();
      if (!["", "none", "off", "false", "0"].includes(refMode)) {
        const refBytes = await this.getReferenceImageBytes();
        if (refBytes) {
          let refType = cleanText(nai.image_reference_type || "character&style") || "character&style";
          if (!["character", "style", "character&style"].includes(refType)) refType = "character&style";
          let strength = Number(nai.image_reference_strength ?? 0.6);
          let fidelity = Number(nai.image_reference_fidelity ?? 1.0);
          if (Number.isNaN(strength)) strength = 0.6;
          if (Number.isNaN(fidelity)) fidelity = 1.0;
          characterRefs.push({
            image: refBytes,
            type: refType,
            strength: Math.max(0, Math.min(1, strength)),
            fidelity: Math.max(0, Math.min(1, fidelity)),
          });
        }
      }
      const vibes = [];
      const vibeMode = cleanText(nai.vibe_transfer || "none").toLowerCase();
      if (!["", "none", "off", "false", "0"].includes(vibeMode)) {
        const vibe = await this.ensureVibeEncoded();
        if (vibe?.encoded) {
          let strength = Number(nai.vibe_transfer_strength ?? 0.6);
          let ie = Number(nai.vibe_transfer_information_extracted ?? vibe.information_extracted ?? 1.0);
          if (Number.isNaN(strength)) strength = 0.6;
          if (Number.isNaN(ie)) ie = 1.0;
          vibes.push({
            encoded: vibe.encoded,
            strength: Math.max(0, Math.min(1, strength)),
            information_extracted: Math.max(0, Math.min(1, ie)),
          });
        }
      }
      const req = {
        prompt: main,
        negative_prompt: neg,
        // Keep payload small — Risu nativeFetch has no body stream; arrayBuffer() of multi-MB ZIPs often hangs.
        width: Math.min(Number(nai.width ?? 640) || 640, 832),
        height: Math.min(Number(nai.height ?? 960) || 960, 1216),
        seed: Number(nai.seed ?? 0) || 0,
        steps: Math.min(Number(nai.steps ?? 28) || 28, 28),
        cfg_scale: Number(nai.cfg_scale ?? 7),
        cfg_rescale: Number(nai.cfg_rescale ?? 0.36),
        sampler: cleanText(nai.sampler) || "k_euler_ancestral",
        scheduler: cleanText(nai.scheduler) || "karras",
        model: modelToNaia(nai.model || "nai-diffusion-4-5-full"),
        var_plus: Boolean(nai.variety_plus),
        characters: captions,
        character_refs: characterRefs,
        vibes,
      };
      // Hard cap pixel count for plugin RPC reliability (~0.8MP).
      if (req.width * req.height > 832 * 1216) {
        req.width = 640;
        req.height = 960;
      }
      dbg("nai.generate.dims", { message: `${req.width}x${req.height}`, steps: req.steps, focus: true });
      if (!req.seed) req.seed = Math.floor(Math.random() * 4294967295) || 1;
      const apiUrl = cleanText(nai.request_url) || API_URL;
      return withGenerateMutex(async () => {
        const result = await generateT2i(token, req, apiUrl, { timeoutMs: 90000 });
        return [result.raw_bytes, req.seed || 0];
      });
    }

    buildImageLocation({ imageId, sessionId, request, shotIndex, paragraph, yPercent, contentHash = "" }) {
      return {
        version: 1,
        image_id: cleanText(imageId, 80),
        session_id: cleanText(sessionId, 200),
        unified_session_id: cleanText(request.unified_session_id || "", 200),
        character_id: cleanText(request.character_id || "", 200),
        character_name: cleanText(request.character_name || "", 200),
        chat_id: cleanText(request.chat_id || "", 200),
        chat_name: cleanText(request.chat_name || "", 200),
        char_index: toInt(request.char_index, -1),
        chat_index: toInt(request.chat_index, -1),
        message_index: toInt(request.message_index, -1),
        message_role: cleanText(request.message_role || request.role || "", 40).toLowerCase(),
        shot_index: toInt(shotIndex, 0),
        paragraph: toInt(paragraph, 0),
        y_percent: yPercent,
        content_hash: cleanText(contentHash || request.content_hash || "", 128),
        assistant_preview: cleanText(request.assistant_text || "", ASSISTANT_PREVIEW_LIMIT),
      };
    }

    async readImageLocation(imageId) {
      const rec = await idbGet("images", imageId);
      return rec?.location && typeof rec.location === "object" ? rec.location : {};
    }

    async writeImageLocation(imageId, location) {
      const rec = (await idbGet("images", imageId)) || { id: imageId };
      rec.location = { ...(location || {}), version: Number(location?.version || 1), image_id: cleanText(imageId, 80) };
      await idbPut("images", rec);
    }

    async locationFieldsForCard(imageId, meta = {}) {
      const loc = await this.readImageLocation(imageId);
      meta = typeof meta === "object" && meta ? meta : {};
      let yPercent = loc.y_percent;
      if (yPercent == null) yPercent = meta.y_percent ?? meta.anchor_percent ?? meta.read_percent;
      yPercent = toOptionalFloat(yPercent);
      const hasLoc = Object.keys(loc).length > 0;
      const storageKey = IMAGE_KEY(cleanText(imageId, 80));
      return {
        character_id: cleanText(loc.character_id || meta.character_id || "", 200),
        chat_id: cleanText(loc.chat_id || meta.chat_id || "", 200),
        character_name: cleanText(loc.character_name || meta.character_name || "", 200),
        chat_name: cleanText(loc.chat_name || meta.chat_name || "", 200),
        char_index: toInt(loc.char_index ?? meta.char_index, -1),
        chat_index: toInt(loc.chat_index ?? meta.chat_index, -1),
        message_index: toInt("message_index" in loc ? loc.message_index : meta.message_index, -1),
        message_role: cleanText(loc.message_role || meta.message_role || "", 40).toLowerCase(),
        shot_index: toInt(loc.shot_index, -1),
        paragraph: toInt("paragraph" in loc ? loc.paragraph : meta.paragraph, 0),
        y_percent: yPercent,
        content_hash: cleanText(loc.content_hash || meta.content_hash || "", 128),
        assistant_preview: cleanText(loc.assistant_preview || meta.assistant_preview || "", ASSISTANT_PREVIEW_LIMIT),
        unified_session_id: cleanText(loc.unified_session_id || meta.unified_session_id || "", 200),
        // UI-compat field: was a sidecar .json path; now an IndexedDB key ref.
        location_file: hasLoc ? `idb:${storageKey}` : "",
        storage: "indexeddb",
        storage_key: storageKey,
      };
    }

    cardMetaFromLocation(meta, location, pngBytes = 0) {
      const base = typeof meta === "object" && meta ? { ...meta } : {};
      const loc = location || {};
      return {
        ...base,
        character_id: cleanText(loc.character_id || base.character_id || "", 200),
        chat_id: cleanText(loc.chat_id || base.chat_id || "", 200),
        character_name: cleanText(loc.character_name || base.character_name || "", 200),
        chat_name: cleanText(loc.chat_name || base.chat_name || "", 200),
        char_index: toInt(loc.char_index ?? base.char_index, -1),
        chat_index: toInt(loc.chat_index ?? base.chat_index, -1),
        message_index: toInt(loc.message_index ?? base.message_index, -1),
        message_role: cleanText(loc.message_role || base.message_role || "", 40).toLowerCase(),
        content_hash: cleanText(loc.content_hash || base.content_hash || "", 128),
        assistant_preview: cleanText(loc.assistant_preview || base.assistant_preview || "", ASSISTANT_PREVIEW_LIMIT),
        unified_session_id: cleanText(loc.unified_session_id || base.unified_session_id || "", 200),
        y_percent: toOptionalFloat(loc.y_percent ?? base.y_percent),
        storage: "indexeddb",
        storage_key: IMAGE_KEY(cleanText(loc.image_id || "", 80)),
        png_bytes: Number(pngBytes) || 0,
      };
    }

    _jobKey(request = {}, sessionId = "") {
      const sid = cleanText(sessionId || request.session_id || "", 200) || "_";
      const hash = cleanText(request.content_hash || "", 128);
      if (hash) return `${sid}::h:${hash}`;
      const mi = toInt(request.message_index, -1);
      if (mi >= 0) return `${sid}::m:${mi}`;
      return `${sid}::all`;
    }

    _beginJobEpoch(jobId, request, sessionId) {
      const key = this._jobKey(request, sessionId);
      const prev = this._jobEpochByKey.get(key);
      const epoch = (prev?.epoch || 0) + 1;
      // Do NOT cancel a still-running same-message job here — caller must busy-check first.
      this._jobEpochByKey.set(key, { epoch, jobId });
      this._jobRunMeta.set(jobId, { key, epoch, cancelRequested: false, publishedIds: [] });
      return { key, epoch };
    }

    _isJobCurrent(jobId) {
      const meta = this._jobRunMeta.get(jobId);
      if (!meta || meta.cancelRequested) return false;
      const cur = this._jobEpochByKey.get(meta.key);
      return !!(cur && cur.jobId === jobId && cur.epoch === meta.epoch);
    }

    async _busyJobIdForKey(key) {
      if (this._messageBusyKeys?.has(key)) return "message-reroll";
      const cur = this._jobEpochByKey.get(key);
      if (!cur?.jobId) return "";
      const meta = this._jobRunMeta.get(cur.jobId);
      if (!meta || meta.cancelRequested) return "";
      const row = await idbGet("jobs", cur.jobId);
      if (!row) return "";
      if (["queued", "tagging", "generating"].includes(String(row.state || ""))) return cur.jobId;
      return "";
    }

    async _busyReplyForRequest(request = {}, sessionId = "") {
      const key = this._jobKey(request, sessionId);
      const busyId = await this._busyJobIdForKey(key);
      if (!busyId) return null;
      return {
        ok: false,
        busy: true,
        accepted: false,
        job_id: busyId === "message-reroll" ? "" : busyId,
        session_id: cleanText(sessionId || request.session_id || "", 200),
        job_state: "busy",
        error: { code: "busy", message: "같은 메시지 작업이 아직 진행 중입니다. 끝날 때까지 기다려 주세요." },
      };
    }

    async _discardJobPublished(jobId) {
      const meta = this._jobRunMeta.get(jobId);
      const ids = meta?.publishedIds ? [...meta.publishedIds] : [];
      if (meta) meta.publishedIds = [];
      for (const id of ids) {
        try {
          await this.deleteCard(id);
        } catch (_) {}
      }
      return ids.length;
    }

    async _cancelJobIfStale(jobId, note = "interrupted") {
      if (this._isJobCurrent(jobId)) return false;
      const dropped = await this._discardJobPublished(jobId);
      await this._setJob(jobId, "cancelled", {
        phase: "cancelled",
        progress: 0,
        message: `${note}${dropped ? ` · discarded ${dropped}` : ""}`,
        shot_count: 0,
        shot_done: 0,
      }, null);
      dbg("job.cancelled", { job_id: jobId, message: note, discarded: dropped, focus: true });
      return true;
    }

    async createJob(request) {
      const card = this.config.card || {};
      if (!card.power && !request.force) throw new Error("Power가 OFF 상태입니다.");
      const sessionId = cleanText(request.session_id, 200) || `sess_${uuid().replace(/-/g, "").slice(0, 12)}`;
      const payload = { ...request, session_id: sessionId };
      const busy = await this._busyReplyForRequest(payload, sessionId);
      if (busy) {
        dbg("job.busy", { message: busy.error?.message || "busy", key: this._jobKey(payload, sessionId), focus: true }, "warn");
        return busy;
      }
      const jobId = uuid();
      const now = Date.now() / 1000;
      this._beginJobEpoch(jobId, payload, sessionId);
      // Fresh cohort only when actually starting (force / retag).
      if (payload.force) {
        try {
          await this.unlinkCardsForMessage(sessionId, cleanText(payload.content_hash || ""), payload.message_index);
        } catch (_) {}
      }
      await idbPut("jobs", {
        id: jobId,
        session_id: sessionId,
        state: "queued",
        request_json: JSON.stringify(payload),
        result_json: null,
        error: null,
        created_at: now,
        updated_at: now,
      });
      this._runJob(jobId).catch(async (err) => {
        console.error("[Inlay Nexus] job crashed", jobId, err);
        try {
          await this._setJob(jobId, "error", null, String(err?.message || err).slice(0, 1500));
        } catch (_) {}
      });
      return { ok: true, accepted: true, job_id: jobId, session_id: sessionId, job_state: "queued" };
    }

    _progressPayload(extra = {}) {
      // Keep progress updates tiny — never re-embed full `tagged` (can be huge; freezes storage).
      return {
        shot_count: extra.shot_count ?? 0,
        shot_index: extra.shot_index ?? 0,
        shot_done: extra.shot_done ?? 0,
        progress: extra.progress ?? 0,
        phase: extra.phase || "generating",
        message: extra.message || "",
        cards_so_far: extra.cards_so_far,
        debug_stage: debugFocusStage || debugLastStage,
        debug_error: debugLastError?.message || "",
      };
    }

    async _setJob(jobId, state, result = null, error = null) {
      const row = await idbGet("jobs", jobId);
      if (!row) return;
      const prevState = row.state;
      row.state = state;
      // Never persist multi-MB data: URLs / tagged into job JSON (freezes IndexedDB RPC).
      let stored = result;
      if (stored && typeof stored === "object") {
        stored = JSON.parse(JSON.stringify(stored, (key, val) => {
          if (key === "image_url" && typeof val === "string" && val.startsWith("data:")) return "";
          if (key === "tagged" || key === "appearance" || key === "debug_tail") return undefined;
          return val;
        }));
      }
      row.result_json = stored != null ? JSON.stringify(stored) : null;
      row.error = error;
      row.updated_at = Date.now() / 1000;
      // Progress ticks stay in memory only — disk flush of whole jobs map was blocking NAI.
      const persistDisk = state !== "generating" || prevState !== "generating" || Boolean(error);
      await idbPut("jobs", row, { persist: persistDisk });
      dbg("job.set", {
        message: `${state}${error ? " ERR" : ""}${persistDisk ? "" : " (mem)"}`,
        job_id: jobId,
        state,
        persist: persistDisk,
        err: error ? String(error).slice(0, 160) : "",
        background: state === "generating",
        focus: state !== "generating",
      });
    }

    async _runJob(jobId) {
      const row = await idbGet("jobs", jobId);
      if (!row) return;
      const request = JSON.parse(row.request_json);
      const sessionId = row.session_id;
      const prevCtx = debugJobCtx;
      debugJobCtx = jobId;
      const jobSpan = dbgSpan("job.run");
      dbg("job.start", {
        job_id: jobId,
        session_id: sessionId,
        message_index: request.message_index,
        text_len: String(request.assistant_text || "").length,
      });
      try {
        if (await this._cancelJobIfStale(jobId, "superseded before start")) return;
        // createJob already unlinked; force path keeps a second pass for safety.
        if (request.force) {
          await this.unlinkCardsForMessage(sessionId, cleanText(request.content_hash || ""), request.message_index);
        }
        if (await this._cancelJobIfStale(jobId, "superseded before tagging")) return;
        await this._setJob(jobId, "tagging", {
          phase: "tagging",
          progress: 0,
          message: "장면 태깅 중…",
          shot_count: 0,
          shot_done: 0,
          debug_stage: "job.tagging",
        });
        let messages = await this.buildTaggerMessages(request);
        dbg("job.tagger.messages", { msgs: messages.length });
        if (this.config.card?.preprocessing) {
          const pre = stripCbs(await this.getPrompt("preprocess"));
          if (pre) {
            const preMessages = [{ role: "system", content: pre }, messages[messages.length - 1]];
            const summary = await this.callLlm(preMessages);
            if (await this._cancelJobIfStale(jobId, "superseded during preprocess")) return;
            messages.splice(messages.length - 1, 0, { role: "system", content: `## Preprocess Summary\n${summary}` });
          }
        }
        const taggedRaw = await this.callLlm(messages);
        if (await this._cancelJobIfStale(jobId, "superseded after tagging")) return;
        const tagged = parseJsonLoose(taggedRaw);
        let shots = this.flattenShots(tagged);
        dbg("job.tagger.done", { shots: shots.length, raw_len: String(taggedRaw || "").length });
        if (!shots.length) throw new Error("태거가 shot을 반환하지 않았습니다.");
        const card = this.config.card || {};
        const imageMin = Math.max(1, Number(card.image_min ?? 1));
        const imageMax = Math.max(imageMin, Number(card.image_max ?? 3));
        shots = shots.slice(0, imageMax);

        const allChars = shots.flatMap((shot) => shot.characters || []);
        const unifiedSessionId = cleanText(request.unified_session_id || "", 200);
        const characterId = cleanText(request.character_id || "", 200);
        const sourceSessionIds = Array.isArray(request.source_session_ids)
          ? request.source_session_ids.map((s) => cleanText(s, 200)).filter(Boolean)
          : [];
        const roster = await this.mergeRosterFromTagged(
          sessionId, tagged, allChars, unifiedSessionId, characterId, sourceSessionIds,
        );
        dbg("job.roster", { roster: roster.length });
        const charMax = characterMaxLimit(card);
        for (const shot of shots) {
          shot.characters = dedupeShotCharacters(shot.characters || [], roster, charMax);
        }
        // Keep appearance updated in character store; do not embed into job JSON.

        if (await this._cancelJobIfStale(jobId, "superseded before generate")) return;
        await this._setJob(jobId, "generating", this._progressPayload({
          shot_count: shots.length,
          shot_index: 0,
          shot_done: 0,
          progress: 0,
          phase: "generating",
          message: `이미지 1/${shots.length} 생성 준비`,
        }));

        const cards = [];
        const wantAnchor = Boolean(card.llm_anchor_percent);
        for (let idx = 0; idx < shots.length; idx++) {
          if (await this._cancelJobIfStale(jobId, `superseded before shot ${idx + 1}`)) return;
          const shot = shots[idx];
          const [main, neg, captions, meta] = await this.buildGenerationForShot(shot, roster);
          const cardId = uuid();
          const now = Date.now() / 1000;
          const contentHash = cleanText(request.content_hash || "");
          // Always persist LLM y% when present. OFF only fakes equal bands at display time.
          let yPercent = null;
          for (const key of ["y_percent", "anchor_percent", "read_percent"]) {
            if (shot[key] == null) continue;
            try {
              yPercent = Math.max(0, Math.min(100, Number(shot[key])));
              break;
            } catch (_) {
              yPercent = null;
            }
          }
          // ON + missing → equal band start so sticky has thresholds. OFF + missing → leave null.
          if (yPercent == null && wantAnchor) {
            yPercent = Math.round((idx / Math.max(1, shots.length)) * 10000) / 100;
          }

          dbg("job.shot.prepare", {
            shot: idx,
            card_id: cardId,
            prompt_len: String(main || "").length,
            captions: (captions || []).length,
          });
          await this._setJob(jobId, "generating", this._progressPayload({
            shot_count: shots.length,
            shot_index: idx,
            shot_done: idx,
            progress: Math.round((idx / Math.max(1, shots.length)) * 1000) / 10,
            phase: "generating",
            message: `NovelAI 요청 중 ${idx + 1}/${shots.length}… [${debugFocusStage}]`,
          }));

          let hbTicks = 0;
          const hb = setInterval(() => {
            hbTicks += 5;
            // If ZIP bytes already arrived but stream never ends, finish immediately.
            if (
              naiBodyControl &&
              naiBodyBytesReceived >= 64 &&
              naiLastByteAt &&
              Date.now() - naiLastByteAt >= 2500
            ) {
              naiBodyControl.forceFinish("heartbeat-idle");
            }
            const kb = naiBodyBytesReceived || naiBodyBytesExpected;
            this._setJob(jobId, "generating", this._progressPayload({
              shot_count: shots.length,
              shot_index: idx,
              shot_done: idx,
              progress: Math.round((idx / Math.max(1, shots.length)) * 1000) / 10,
              phase: "generating",
              message: `NovelAI 대기 ${idx + 1}/${shots.length} (${hbTicks}s) · ${debugFocusStage}${kb ? ` ${Math.round(kb / 1024)}KB` : ""}`,
            })).catch(() => {});
          }, 5000);

          let raw;
          let seed;
          try {
            // Finish current NAI image even if interrupted mid-flight; discard after if stale.
            [raw, seed] = await this.generateImage(main, neg, captions);
          } finally {
            clearInterval(hb);
          }
          dbg("job.shot.nai_done", { shot: idx, bytes: raw?.byteLength || 0, seed });

          if (await this._cancelJobIfStale(jobId, `superseded after shot ${idx + 1} nai`)) return;

          await this._setJob(jobId, "generating", this._progressPayload({
            shot_count: shots.length,
            shot_index: idx,
            shot_done: idx,
            progress: Math.round(((idx + 0.5) / Math.max(1, shots.length)) * 1000) / 10,
            phase: "generating",
            message: `이미지 저장 중 ${idx + 1}/${shots.length}… [${debugFocusStage}]`,
          }));
          const location = this.buildImageLocation({
            imageId: cardId,
            sessionId,
            request,
            shotIndex: idx,
            paragraph: shot.paragraph,
            yPercent,
            contentHash,
          });
          await publishImage(cardId, raw, location);
          const cardMeta = this.cardMetaFromLocation(meta, location, raw?.byteLength || 0);
          await idbPut("cards", {
            id: cardId,
            job_id: jobId,
            session_id: sessionId,
            shot_index: idx,
            paragraph: Number(shot.paragraph || 0),
            main_prompt: main,
            negative_prompt: neg,
            characters_json: JSON.stringify(meta.characters || []),
            seed,
            meta_json: JSON.stringify(cardMeta),
            created_at: now,
          });
          const runMeta = this._jobRunMeta.get(jobId);
          if (runMeta) runMeta.publishedIds.push(cardId);
          if (await this._cancelJobIfStale(jobId, `superseded after shot ${idx + 1} save`)) return;
          cards.push({
            id: cardId,
            shot_index: idx,
            paragraph: location.paragraph,
            y_percent: location.y_percent,
            message_index: location.message_index ?? -1,
            message_role: location.message_role || "",
            content_hash: location.content_hash || "",
            character_id: location.character_id || "",
            chat_id: location.chat_id || "",
            character_name: location.character_name || "",
            chat_name: location.chat_name || "",
            char_index: location.char_index ?? -1,
            chat_index: location.chat_index ?? -1,
            assistant_preview: cleanText(request.assistant_text || "", ASSISTANT_PREVIEW_LIMIT),
            main_prompt: main,
            negative_prompt: neg,
            characters: meta.characters || [],
            image_url: resolveImageUrl(cardId),
            seed,
            storage: "indexeddb",
            png_bytes: raw?.byteLength || 0,
          });
          dbg("job.shot.saved", { shot: idx, card_id: cardId, has_url: Boolean(resolveImageUrl(cardId)) });
          await this._setJob(jobId, "generating", this._progressPayload({
            shot_count: shots.length,
            shot_index: idx,
            shot_done: idx + 1,
            progress: Math.round(((idx + 1) / Math.max(1, shots.length)) * 1000) / 10,
            phase: "generating",
            message: `이미지 ${idx + 1}/${shots.length} 완료`,
            cards_so_far: cards.length,
          }));
        }
        if (await this._cancelJobIfStale(jobId, "superseded before done")) return;
        const result = {
          cards,
          message_index: request.message_index != null ? Number(request.message_index) : -1,
          shot_count: shots.length,
          shot_done: shots.length,
          progress: 100,
          phase: "done",
          message: `이미지 ${shots.length}/${shots.length} 완료`,
        };
        await attachImageUrls(result);
        await this._setJob(jobId, "done", result);
        const doneMeta = this._jobRunMeta.get(jobId);
        if (doneMeta) doneMeta.publishedIds = [];
        jobSpan.end({ message: "done", cards: cards.length });
      } catch (exc) {
        jobSpan.fail(exc);
        const errText = `${exc?.message || exc}\n${exc?.stack || ""}`.slice(-1500);
        await this._setJob(jobId, "error", {
          phase: "error",
          message: String(exc?.message || exc).slice(0, 240),
          debug_stage: debugLastStage,
          debug_tail: debugEvents.filter((e) => e.job_id === jobId).slice(-12),
        }, errText);
      } finally {
        debugJobCtx = prevCtx;
      }
    }

    async getJob(jobId) {
      const row = await idbGet("jobs", jobId);
      if (!row) return { ok: false, error: { code: "not_found", message: "job not found" } };
      const result = row.result_json ? JSON.parse(row.result_json) : null;
      const progress = {};
      if (result && typeof result === "object") {
        for (const key of ["shot_count", "shot_index", "shot_done", "progress", "phase", "message", "cards_so_far", "debug_stage", "debug_error"]) {
          if (key in result) progress[key] = result[key];
        }
      }
      if (result) await attachImageUrls(result);
      const jobEvents = debugEvents.filter((e) => e.job_id === jobId).slice(-40);
      return {
        ok: true,
        job_id: row.id,
        session_id: row.session_id,
        state: row.state,
        error: row.error,
        result,
        progress,
        debug: {
          last_stage: debugLastStage,
          last_error: debugLastError,
          events: jobEvents,
        },
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }

    async galleryExplore(limit = 400) {
      const rows = (await idbGetAll("cards")).sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, Math.max(1, Math.min(2000, limit)));
      const folders = {};
      const items = [];
      for (const row of rows) {
        let meta = {};
        try {
          meta = JSON.parse(row.meta_json || "{}");
        } catch (_) {
          meta = {};
        }
        const loc = await this.locationFieldsForCard(row.id, meta);
        const sidecar = await this.readImageLocation(row.id);
        const characterName = cleanText(loc.character_name || sidecar.character_name || meta.character_name || "", 200);
        const chatName = cleanText(loc.chat_name || sidecar.chat_name || meta.chat_name || "", 200);
        const characterId = cleanText(loc.character_id || "", 200) || "unknown";
        const chatId = cleanText(loc.chat_id || "", 200) || "unknown";
        const folderKey = `${characterId}|${chatId}`;
        if (!folders[folderKey]) {
          folders[folderKey] = {
            key: folderKey,
            character_id: characterId,
            chat_id: chatId,
            character_name: characterName || characterId.slice(0, 12) || "Unknown",
            chat_name: chatName || `chat ${loc.chat_index ?? "?"}`,
            char_index: loc.char_index ?? -1,
            chat_index: loc.chat_index ?? -1,
            count: 0,
            storage: "indexeddb",
          };
        }
        if (characterName && !folders[folderKey].character_name) folders[folderKey].character_name = characterName;
        if (chatName) folders[folderKey].chat_name = chatName;
        folders[folderKey].count++;
        const shotIndex = loc.shot_index >= 0 ? loc.shot_index : row.shot_index;
        const paragraph = Object.keys(sidecar).length ? loc.paragraph : row.paragraph;
        const imgRec = await idbGet("images", row.id);
        const pngBytes = imgRec?.png?.byteLength || Number(meta.png_bytes) || 0;
        items.push({
          id: row.id,
          job_id: row.job_id,
          session_id: row.session_id,
          folder_key: folderKey,
          shot_index: shotIndex,
          paragraph,
          y_percent: loc.y_percent,
          message_index: loc.message_index ?? -1,
          message_role: loc.message_role || "",
          content_hash: loc.content_hash || "",
          character_id: characterId,
          character_name: folders[folderKey].character_name,
          chat_id: chatId,
          chat_name: folders[folderKey].chat_name,
          char_index: loc.char_index ?? -1,
          chat_index: loc.chat_index ?? -1,
          assistant_preview: cleanText(loc.assistant_preview || sidecar.assistant_preview || meta.assistant_preview || "", ASSISTANT_PREVIEW_LIMIT),
          main_prompt: row.main_prompt,
          characters: JSON.parse(row.characters_json || "[]"),
          image_url: resolveImageUrl(row.id),
          seed: row.seed,
          created_at: row.created_at,
          storage: "indexeddb",
          storage_key: loc.storage_key || IMAGE_KEY(row.id),
          location_file: loc.location_file || "",
          png_bytes: pngBytes,
        });
      }
      const folderList = Object.values(folders).sort((a, b) =>
        `${a.character_name || ""}`.localeCompare(`${b.character_name || ""}`, undefined, { sensitivity: "base" }) ||
        `${a.chat_name || ""}`.localeCompare(`${b.chat_name || ""}`, undefined, { sensitivity: "base" }),
      );
      const payload = {
        ok: true,
        folders: folderList,
        items,
        total: items.length,
        storage: "indexeddb",
        storage_api: "getLocalPluginStorage",
      };
      await attachImageUrls(payload, { cachedOnly: true });
      return payload;
    }

    async gallery(sessionId, limit = 40) {
      const rows = (await idbGetAll("cards"))
        .filter((r) => r.session_id === sessionId)
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, Number(limit));
      const items = [];
      for (const row of rows) {
        let meta = {};
        try {
          meta = JSON.parse(row.meta_json || "{}");
        } catch (_) {
          meta = {};
        }
        const loc = await this.locationFieldsForCard(row.id, meta);
        const sidecar = await this.readImageLocation(row.id);
        const shotIndex = loc.shot_index >= 0 ? loc.shot_index : row.shot_index;
        const paragraph = Object.keys(sidecar).length ? loc.paragraph : row.paragraph;
        const imgRec = await idbGet("images", row.id);
        items.push({
          id: row.id,
          job_id: row.job_id,
          shot_index: shotIndex,
          paragraph,
          y_percent: loc.y_percent,
          message_index: loc.message_index ?? -1,
          message_role: loc.message_role || "",
          content_hash: loc.content_hash || "",
          character_id: loc.character_id || "",
          chat_id: loc.chat_id || "",
          character_name: loc.character_name || "",
          chat_name: loc.chat_name || "",
          char_index: loc.char_index ?? -1,
          chat_index: loc.chat_index ?? -1,
          assistant_preview: loc.assistant_preview || meta.assistant_preview || "",
          main_prompt: row.main_prompt,
          negative_prompt: row.negative_prompt,
          characters: JSON.parse(row.characters_json || "[]"),
          image_url: resolveImageUrl(row.id),
          seed: row.seed,
          created_at: row.created_at,
          storage: "indexeddb",
          storage_key: loc.storage_key || IMAGE_KEY(row.id),
          png_bytes: imgRec?.png?.byteLength || Number(meta.png_bytes) || 0,
        });
      }
      const payload = { ok: true, session_id: sessionId, items, storage: "indexeddb" };
      await attachImageUrls(payload, { cachedOnly: true });
      return payload;
    }

    /**
     * One-shot streaming hash upgrade: rewrite content_hash (+ preview) on chosen cards.
     * Client filters by character/chat/msg/role + Dice; server only writes.
     */
    async rebindCardsHash({ session_id = "", card_ids = [], to_hash = "", assistant_preview = "" } = {}) {
      const sessionId = cleanText(session_id, 200);
      const toHash = cleanText(to_hash, 128);
      const preview = cleanText(assistant_preview || "", ASSISTANT_PREVIEW_LIMIT);
      const ids = (Array.isArray(card_ids) ? card_ids : []).map((id) => cleanText(id, 80)).filter(Boolean);
      if (!toHash || !ids.length) {
        return { ok: false, error: { code: "bad_request", message: "to_hash and card_ids required" }, rebound: 0, ids: [] };
      }
      const rebound = [];
      for (const cardId of ids) {
        const row = await idbGet("cards", cardId);
        if (!row) continue;
        if (sessionId && cleanText(row.session_id || "", 200) !== sessionId) continue;
        let meta = {};
        try {
          meta = JSON.parse(row.meta_json || "{}");
        } catch (_) {
          meta = {};
        }
        const existing = await this.readImageLocation(cardId);
        const nextLoc = {
          ...existing,
          image_id: cardId,
          content_hash: toHash,
          assistant_preview: preview || existing.assistant_preview || "",
        };
        await this.writeImageLocation(cardId, nextLoc);
        meta.content_hash = toHash;
        if (preview) meta.assistant_preview = preview;
        meta.message_role = cleanText(meta.message_role || existing.message_role || "", 40).toLowerCase();
        row.meta_json = JSON.stringify(meta);
        await idbPut("cards", row);
        rebound.push(cardId);
      }
      dbg("gallery.rebind", { n: rebound.length, to: toHash.slice(0, 8) });
      return { ok: true, rebound: rebound.length, ids: rebound, content_hash: toHash };
    }

    async unlinkCardsForMessage(sessionId, contentHash = "", messageIndex = null) {
      sessionId = cleanText(sessionId, 200);
      contentHash = cleanText(contentHash || "");
      let msgIdx = null;
      try {
        if (messageIndex != null && String(messageIndex).trim() !== "") msgIdx = parseInt(messageIndex, 10);
      } catch (_) {
        msgIdx = null;
      }
      if (!sessionId || (!contentHash && msgIdx == null)) return { ok: true, unlinked: 0, ids: [] };
      const rows = (await idbGetAll("cards")).filter((r) => r.session_id === sessionId);
      const unlinkedIds = [];
      for (const row of rows) {
        let meta = {};
        try {
          meta = JSON.parse(row.meta_json || "{}");
        } catch (_) {
          meta = {};
        }
        const loc = await this.locationFieldsForCard(row.id, meta);
        const cardHash = cleanText(loc.content_hash || "");
        const cardMsg = toInt(loc.message_index, -1);
        let match = false;
        if (contentHash && cardHash && cardHash === contentHash) match = true;
        else if (msgIdx != null && msgIdx >= 0 && cardMsg === msgIdx) match = true;
        if (!match) continue;
        const existing = await this.readImageLocation(row.id);
        const cleared = {
          ...(existing || {}),
          version: 1,
          image_id: row.id,
          session_id: sessionId,
          content_hash: "",
          message_index: -1,
          character_id: "",
          chat_id: "",
          char_index: -1,
          chat_index: -1,
          unlinked_at: Date.now() / 1000,
        };
        await this.writeImageLocation(row.id, cleared);
        if (meta.content_hash || meta.message_index != null || meta.assistant_preview) {
          meta.content_hash = "";
          meta.assistant_preview = "";
          meta.message_index = -1;
          meta.unlinked_at = Date.now() / 1000;
          row.meta_json = JSON.stringify(meta);
          await idbPut("cards", row);
        }
        unlinkedIds.push(row.id);
      }
      return { ok: true, unlinked: unlinkedIds.length, ids: unlinkedIds };
    }

    async deleteCard(cardId) {
      cardId = cleanText(cardId, 80);
      if (!cardId) return { ok: false, error: { code: "bad_request", message: "card_id required" } };
      const row = await idbGet("cards", cardId);
      if (!row) return { ok: false, error: { code: "not_found", message: "card not found" } };
      await idbDelete("cards", cardId);
      await idbDelete("images", cardId);
      blobUrlCache.delete(cardId);
      return { ok: true, deleted: 1, ids: [cardId] };
    }

    async deleteCards(cardIds = []) {
      const ids = [...new Set((cardIds || []).map((id) => cleanText(id, 80)).filter(Boolean))];
      const deleted = [];
      for (const id of ids) {
        const result = await this.deleteCard(id);
        if (result.ok) deleted.push(id);
      }
      return { ok: true, deleted: deleted.length, ids: deleted };
    }

    async getExplorerFavorites() {
      const row = await idbGet("meta", "explorer_favorites");
      const ids = Array.isArray(row?.ids) ? row.ids.map((id) => cleanText(id, 80)).filter(Boolean) : [];
      return { ok: true, ids };
    }

    async setExplorerFavorites(ids = []) {
      const clean = [...new Set((ids || []).map((id) => cleanText(id, 80)).filter(Boolean))].slice(0, 5000);
      await idbPut("meta", { key: "explorer_favorites", ids: clean, updated_at: Date.now() / 1000 });
      return { ok: true, ids: clean };
    }

    async exportGalleryZip({ card_ids = null, folder_key = "", all = false } = {}) {
      const Zip = globalThis.__INLAY_GALLERY_ZIP__;
      if (!Zip?.buildGalleryManifest || !Zip?.packGalleryZip) {
        return { ok: false, error: { code: "unavailable", message: "gallery zip helpers missing" } };
      }
      const explore = await this.galleryExplore(2000);
      let items = explore.items || [];
      const folderKey = cleanText(folder_key || "", 400);
      if (all) {
        // keep all
      } else if (folderKey) {
        items = items.filter((it) => it.folder_key === folderKey);
      } else if (Array.isArray(card_ids) && card_ids.length) {
        const want = new Set(card_ids.map((id) => cleanText(id, 80)));
        items = items.filter((it) => want.has(it.id));
      } else {
        return { ok: false, error: { code: "bad_request", message: "card_ids, folder_key, or all required" } };
      }
      if (!items.length) return { ok: false, error: { code: "empty", message: "no images to export" } };
      const manifest = Zip.buildGalleryManifest(items);
      const files = [{ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }];
      for (const item of items) {
        const png = await this.getImageBytes(item.id);
        if (!png?.byteLength) continue;
        const u8 = png instanceof Uint8Array ? png : new Uint8Array(png);
        files.push({ name: `images/${item.id}.png`, data: u8 });
      }
      if (files.length < 2) return { ok: false, error: { code: "empty", message: "image bytes missing" } };
      const zip = Zip.packGalleryZip(files);
      let binary = "";
      const chunk = 0x2000;
      for (let i = 0; i < zip.length; i += chunk) {
        const slice = zip.subarray(i, i + chunk);
        let part = "";
        for (let j = 0; j < slice.length; j += 1) part += String.fromCharCode(slice[j]);
        binary += part;
      }
      return {
        ok: true,
        count: files.length - 1,
        filename: `inlay-gallery-${Date.now()}.zip`,
        zip_base64: btoa(binary),
        bytes: zip.length,
      };
    }

    async importGalleryZip({ zip_base64 = "", prefer_new_ids = true } = {}) {
      const Zip = globalThis.__INLAY_GALLERY_ZIP__;
      if (!Zip?.unpackGalleryZip || !Zip?.resolveReattach) {
        return { ok: false, error: { code: "unavailable", message: "gallery zip helpers missing" } };
      }
      const b64 = String(zip_base64 || "").replace(/^data:.*base64,/, "");
      if (!b64) return { ok: false, error: { code: "bad_request", message: "zip_base64 required" } };
      let raw;
      try {
        const bin = atob(b64);
        raw = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) raw[i] = bin.charCodeAt(i);
      } catch (err) {
        return { ok: false, error: { code: "bad_request", message: `invalid base64: ${err?.message || err}` } };
      }
      const { manifest, images } = Zip.unpackGalleryZip(raw);
      if (!manifest?.items?.length) return { ok: false, error: { code: "bad_request", message: "manifest.items missing" } };
      const explore = await this.galleryExplore(2000);
      const existing = explore.items || [];
      const imported = [];
      const report = { exact: 0, candidate: 0, orphan: 0, skipped: 0 };
      for (const item of manifest.items) {
        const file = String(item.file || `images/${item.id}.png`).replace(/\\/g, "/");
        const png = images.get(file) || images.get(`images/${item.id}.png`);
        if (!png?.byteLength) {
          report.skipped += 1;
          continue;
        }
        const decision = Zip.resolveReattach(item, existing);
        report[decision.status] = (report[decision.status] || 0) + 1;
        const loc = { ...(item.location || {}) };
        // Keep location for reattach; orphan still stores location for later jump/manual fix.
        const newId = prefer_new_ids ? uuid() : cleanText(item.id || "", 80) || uuid();
        const sessionId = cleanText(loc.session_id || "", 200) || `import_${uuid().replace(/-/g, "").slice(0, 10)}`;
        const location = {
          version: 1,
          image_id: newId,
          session_id: sessionId,
          character_id: cleanText(loc.character_id || "", 200),
          character_name: cleanText(loc.character_name || "", 200),
          chat_id: cleanText(loc.chat_id || "", 200),
          chat_name: cleanText(loc.chat_name || "", 200),
          char_index: toInt(loc.char_index, -1),
          chat_index: toInt(loc.chat_index, -1),
          message_index: toInt(loc.message_index, -1),
          shot_index: toInt(loc.shot_index, 0),
          paragraph: toInt(loc.paragraph, 0),
          y_percent: toOptionalFloat(loc.y_percent),
          content_hash: cleanText(loc.content_hash || "", 128),
          assistant_preview: cleanText(loc.assistant_preview || "", ASSISTANT_PREVIEW_LIMIT),
          imported_at: Date.now() / 1000,
          reattach: decision.status,
        };
        await publishImage(newId, png, location);
        const meta = this.cardMetaFromLocation({
          ...(item.meta || {}),
          assistant_preview: location.assistant_preview,
          imported_at: location.imported_at,
          reattach: decision.status,
        }, location, png.byteLength || 0);
        await idbPut("cards", {
          id: newId,
          job_id: `import_${newId.slice(0, 8)}`,
          session_id: sessionId,
          shot_index: location.shot_index,
          paragraph: location.paragraph,
          main_prompt: cleanText(item.meta?.main_prompt || "", 8000),
          negative_prompt: "",
          characters_json: JSON.stringify(item.meta?.characters || []),
          seed: item.meta?.seed ?? 0,
          meta_json: JSON.stringify(meta),
          created_at: Number(item.meta?.created_at) || Date.now() / 1000,
        });
        imported.push({ id: newId, reattach: decision.status, content_hash: location.content_hash });
      }
      return { ok: true, imported: imported.length, items: imported, report };
    }

    async deleteFolder(folderKey) {
      folderKey = cleanText(folderKey, 400);
      if (!folderKey || !folderKey.includes("|")) return { ok: false, error: { code: "bad_request", message: "folder_key required" } };
      const [characterId, chatId] = folderKey.split("|", 2);
      const cid = cleanText(characterId, 200) || "unknown";
      const chid = cleanText(chatId, 200) || "unknown";
      const rows = await idbGetAll("cards");
      const deletedIds = [];
      for (const row of rows) {
        let meta = {};
        try {
          meta = JSON.parse(row.meta_json || "{}");
        } catch (_) {
          meta = {};
        }
        const loc = await this.locationFieldsForCard(row.id, meta);
        const rowCid = cleanText(loc.character_id || "", 200) || "unknown";
        const rowChid = cleanText(loc.chat_id || "", 200) || "unknown";
        if (rowCid !== cid || rowChid !== chid) continue;
        const result = await this.deleteCard(row.id);
        if (result.ok) deletedIds.push(row.id);
      }
      return { ok: true, deleted: deletedIds.length, ids: deletedIds, folder_key: `${cid}|${chid}` };
    }

    async getImageBytes(cardId) {
      const rec = await idbGet("images", cardId);
      return rec?.png || null;
    }

    async updateCardTags(cardId, body = {}) {
      cardId = cleanText(cardId, 80);
      const row = await idbGet("cards", cardId);
      if (!row) return { ok: false, error: { code: "not_found", message: "card not found" } };
      let oldChars = [];
      try {
        oldChars = JSON.parse(row.characters_json || "[]");
      } catch (_) {
        oldChars = [];
      }
      if (!Array.isArray(oldChars)) oldChars = [];
      let main = row.main_prompt;
      if ("main_prompt" in body) main = cleanText(body.main_prompt, 8000);
      let neg = row.negative_prompt;
      if ("negative_prompt" in body) neg = cleanText(body.negative_prompt, 8000);
      let chars = oldChars;
      if ("characters" in body) {
        const rawChars = body.characters || [];
        if (!Array.isArray(rawChars)) return { ok: false, error: { code: "bad_request", message: "characters must be a list" } };
        chars = [];
        const limit = characterMaxLimit(this.config.card || {});
        for (let idx = 0; idx < rawChars.slice(0, limit).length; idx++) {
          const ch = rawChars[idx];
          if (typeof ch !== "object") continue;
          const prev = idx < oldChars.length && typeof oldChars[idx] === "object" ? oldChars[idx] : {};
          const name = cleanText(ch.name != null ? ch.name : prev.name, 200);
          const prompt = cleanText(ch.prompt != null ? ch.prompt : prev.prompt, 4000);
          if (!name && !prompt) continue;
          const entry = { ...prev, name: name || `char${idx + 1}`, prompt: prompt || "girl" };
          if ("uc" in ch) entry.uc = cleanText(ch.uc, 2000);
          for (const key of ["center_x", "center_y"]) {
            if (key in ch) {
              try {
                entry[key] = Number(ch[key]);
              } catch (_) {}
            }
          }
          chars.push(entry);
        }
      }
      row.main_prompt = main;
      row.negative_prompt = neg;
      row.characters_json = JSON.stringify(chars);
      // Keep meta.setup/characters in sync so plain /reroll (no overrides) uses saved tags.
      try {
        let meta = {};
        try {
          meta = JSON.parse(row.meta_json || "{}");
        } catch (_) {
          meta = {};
        }
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = {};
        meta.setup = main;
        meta.characters = chars;
        row.meta_json = JSON.stringify(meta);
      } catch (_) {}
      await idbPut("cards", row);
      const loc = await this.locationFieldsForCard(cardId, {});
      const card = {
        id: cardId,
        main_prompt: main,
        negative_prompt: neg,
        characters: chars,
        paragraph: row.paragraph,
        shot_index: row.shot_index,
        y_percent: loc.y_percent,
        message_index: loc.message_index ?? -1,
        content_hash: loc.content_hash || "",
        image_url: resolveImageUrl(cardId),
      };
      await attachImageUrls(card);
      return { ok: true, card };
    }

    async rerollCard(cardId, mode = "nai", overrides = null, opts = {}) {
      const row = await idbGet("cards", cardId);
      if (!row) return { ok: false, error: { code: "not_found", message: "card not found" } };
      const sessionId = row.session_id;
      let meta = {};
      try {
        meta = JSON.parse(row.meta_json || "{}");
      } catch (_) {
        meta = {};
      }
      const prevLocMeta = meta.location || {};
      if (!opts.skipBusyCheck) {
        try {
          const loc0 = await this.locationFieldsForCard(cardId, meta);
          const busy = await this._busyReplyForRequest({
            session_id: sessionId,
            content_hash: cleanText(loc0.content_hash || meta.content_hash || "", 128),
            message_index: toInt(loc0.message_index ?? meta.message_index, -1),
          }, sessionId);
          if (busy) return busy;
        } catch (_) {}
      }
      const characterId = cleanText(prevLocMeta.character_id || meta.character_id || "", 200);
      let unifiedSessionId = cleanText(meta.unified_session_id || prevLocMeta.unified_session_id || "", 200);
      if (!unifiedSessionId && characterId) unifiedSessionId = unifiedSessionIdForCharacter(characterId);
      let sourceSessionIds = [];
      try {
        const job = await idbGet("jobs", row.job_id);
        if (job?.request_json) {
          const req = JSON.parse(job.request_json);
          if (Array.isArray(req.source_session_ids)) {
            sourceSessionIds = req.source_session_ids.map((s) => cleanText(s, 200)).filter(Boolean);
          }
        }
      } catch (_) {}
      const roster = await this.rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
      if (mode === "full") {
        const job = await idbGet("jobs", row.job_id);
        if (!job) return { ok: false, error: { code: "no_job", message: "original job missing" } };
        const request = JSON.parse(job.request_json);
        request.force = true;
        return this.createJob(request);
      }

      let main;
      let neg;
      let captions;
      let charList;
      let genMetaExtra = {};

      if (overrides && ("main_prompt" in overrides || "negative_prompt" in overrides || "characters" in overrides)) {
        main = "main_prompt" in overrides ? cleanText(overrides.main_prompt || "") : cleanText(row.main_prompt);
        neg = "negative_prompt" in overrides ? cleanText(overrides.negative_prompt || "") : cleanText(row.negative_prompt);
        charList = "characters" in overrides ? overrides.characters : null;
        if (charList == null) {
          try {
            charList = JSON.parse(row.characters_json || "[]");
          } catch (_) {
            charList = [];
          }
        }
        captions = (charList || []).slice(0, characterMaxLimit(this.config.card || {})).map((ch) => ({
          prompt: normalizeCharacterCaptionTags(ch.prompt || "girl") || "girl",
          uc: cleanText(ch.uc),
          center_x: Number(ch.center_x ?? 0.5),
          center_y: Number(ch.center_y ?? 0.5),
        }));
      } else if (cleanText(row.main_prompt || "")) {
        // Keep saved scene (main_prompt / neg); reinject current roster looks + shot action/expression into captions only.
        let storedChars = [];
        try {
          storedChars = JSON.parse(row.characters_json || "[]");
        } catch (_) {
          storedChars = [];
        }
        if (!Array.isArray(storedChars)) storedChars = [];
        const rawFromMeta = Array.isArray(meta.characters)
          ? meta.characters.map((c) => (c && typeof c === "object" ? (c.raw || c) : null)).filter(Boolean)
          : [];
        const rawFromStored = storedChars.map((c) => {
          if (!c || typeof c !== "object") return null;
          if (c.raw && typeof c.raw === "object") return { ...c.raw, name: cleanText(c.raw.name || c.name, 200) };
          return {
            name: cleanText(c.name, 200),
            action: c.action,
            expression: c.expression,
            sex: c.sex,
            label: c.label,
            age: c.age,
            original: c.original || c.original_tag,
          };
        }).filter(Boolean);
        const shotChars = rawFromMeta.length ? rawFromMeta : rawFromStored;
        const shot = {
          characters: shotChars,
          paragraph: row.paragraph,
          camera: "",
          situation: "",
          place: "",
          action: "",
        };
        // Do not pass main_prompt as lockedSetup — that would double person/style/quality via joinTags.
        const built = await this.buildGenerationForShot(shot, roster, {});
        main = cleanText(row.main_prompt);
        neg = cleanText(row.negative_prompt) || built[1];
        captions = built[2];
        charList = built[3].characters || [];
        genMetaExtra = {
          setup: main,
          person: built[3].person,
          characters: charList,
        };
      } else {
        // Keep LLM scene tags (meta.setup); reinject current roster looks + active card preset.
        let storedChars = [];
        try {
          storedChars = JSON.parse(row.characters_json || "[]");
        } catch (_) {
          storedChars = [];
        }
        const rawFromMeta = Array.isArray(meta.characters)
          ? meta.characters.map((c) => (c && typeof c === "object" ? (c.raw || c) : null)).filter(Boolean)
          : [];
        const rawFromStored = (storedChars || []).map((c) => (c && typeof c === "object" ? (c.raw || { name: c.name, action: c.action, expression: c.expression }) : null)).filter(Boolean);
        const shotChars = rawFromMeta.length ? rawFromMeta : rawFromStored;
        const lockedSetup = cleanText(meta.setup || "");
        const shot = {
          characters: shotChars,
          paragraph: row.paragraph,
          camera: lockedSetup ? "" : cleanText(meta.camera || ""),
          situation: lockedSetup ? "" : cleanText(meta.situation || meta.scene || ""),
          place: lockedSetup ? "" : cleanText(meta.place || ""),
          action: lockedSetup ? "" : cleanText(meta.action || ""),
        };
        const built = await this.buildGenerationForShot(shot, roster, lockedSetup ? { lockedSetup } : {});
        main = built[0];
        neg = built[1];
        captions = built[2];
        charList = built[3].characters || [];
        genMetaExtra = {
          setup: built[3].setup,
          person: built[3].person,
          characters: charList,
        };
      }

      if (!captions.length && !(overrides && "characters" in overrides)) {
        const shot = { characters: (meta.characters || []).map((c) => c.raw || c), camera: meta.setup };
        const built = await this.buildGenerationForShot(shot, roster);
        main = built[0];
        neg = built[1];
        captions = built[2];
        charList = built[3].characters || [];
        genMetaExtra = {
          setup: built[3].setup,
          person: built[3].person,
          characters: charList,
        };
      }

      const [raw, seed] = await this.generateImage(main, neg, captions);
      const newId = uuid();
      const now = Date.now() / 1000;
      let prevLoc = await this.readImageLocation(row.id);
      if (!Object.keys(prevLoc).length) prevLoc = await this.locationFieldsForCard(row.id, meta);
      const location = {
        version: 1,
        image_id: newId,
        session_id: sessionId,
        unified_session_id: unifiedSessionId,
        character_id: cleanText(prevLoc.character_id || "", 200),
        character_name: cleanText(prevLoc.character_name || meta.character_name || "", 200),
        chat_id: cleanText(prevLoc.chat_id || "", 200),
        chat_name: cleanText(prevLoc.chat_name || meta.chat_name || "", 200),
        char_index: toInt(prevLoc.char_index, -1),
        chat_index: toInt(prevLoc.chat_index, -1),
        message_index: toInt(prevLoc.message_index, -1),
        shot_index: toInt(prevLoc.shot_index, toInt(row.shot_index, 0)),
        paragraph: toInt(prevLoc.paragraph, toInt(row.paragraph, 0)),
        y_percent: toOptionalFloat(prevLoc.y_percent),
        content_hash: cleanText(prevLoc.content_hash || "", 128),
        assistant_preview: cleanText(prevLoc.assistant_preview || meta.assistant_preview || "", ASSISTANT_PREVIEW_LIMIT),
      };
      await publishImage(newId, raw, location);
      const genMeta = this.cardMetaFromLocation({ ...meta, ...genMetaExtra }, location, raw?.byteLength || 0);
      for (const key of ["y_percent", "anchor_percent", "read_percent"]) delete genMeta[key];
      genMeta.y_percent = location.y_percent;
      await idbPut("cards", {
        id: newId,
        job_id: row.job_id,
        session_id: sessionId,
        shot_index: row.shot_index,
        paragraph: row.paragraph,
        main_prompt: main,
        negative_prompt: neg,
        characters_json: JSON.stringify(charList),
        seed,
        meta_json: JSON.stringify(genMeta),
        created_at: now,
      });
      try {
        await this.deleteCard(cardId);
      } catch (_) {}
      const card = {
        id: newId,
        image_url: resolveImageUrl(newId),
        main_prompt: main,
        negative_prompt: neg,
        characters: charList,
        seed,
        paragraph: location.paragraph ?? row.paragraph,
        y_percent: location.y_percent,
        message_index: location.message_index ?? -1,
        shot_index: location.shot_index ?? 0,
        content_hash: location.content_hash || "",
        character_id: location.character_id || "",
        chat_id: location.chat_id || "",
        character_name: location.character_name || "",
        chat_name: location.chat_name || "",
        assistant_preview: location.assistant_preview || "",
        storage: "indexeddb",
        png_bytes: raw?.byteLength || 0,
      };
      await attachImageUrls(card);
      return { ok: true, replaced: cardId, card };
    }

    /** Reroll every card for a message (keep LLM setup, reinject char+preset). */
    async rerollMessageCards({ session_id = "", content_hash = "", message_index = -1 } = {}) {
      const sessionId = cleanText(session_id, 200);
      const contentHash = cleanText(content_hash, 128);
      const msgIndex = toInt(message_index, -1);
      if (!sessionId && !contentHash && msgIndex < 0) {
        return { ok: false, error: { code: "bad_request", message: "session_id or content_hash required" } };
      }
      const rows = await idbGetAll("cards");
      const targets = [];
      for (const row of rows) {
        if (sessionId && row.session_id !== sessionId) continue;
        let meta = {};
        try {
          meta = JSON.parse(row.meta_json || "{}");
        } catch (_) {
          meta = {};
        }
        const loc = await this.locationFieldsForCard(row.id, meta);
        const hash = cleanText(loc.content_hash || meta.content_hash || "", 128);
        const mi = toInt(loc.message_index ?? meta.message_index, -1);
        if (contentHash) {
          if (hash !== contentHash) continue;
        } else if (msgIndex >= 0) {
          if (mi !== msgIndex) continue;
        } else {
          continue;
        }
        const yRaw = loc.y_percent ?? meta.y_percent ?? meta.anchor_percent ?? meta.read_percent;
        const y = Number(yRaw);
        targets.push({
          row,
          y: Number.isFinite(y) ? y : 999,
          shot: toInt(row.shot_index, 0),
          paragraph: toInt(row.paragraph ?? loc.paragraph ?? meta.paragraph, 0),
        });
      }
      targets.sort((a, b) => a.y - b.y || a.shot - b.shot || a.paragraph - b.paragraph);
      if (!targets.length) return { ok: false, error: { code: "not_found", message: "no cards for message" } };
      const sid = sessionId || cleanText(targets[0]?.row?.session_id || "", 200);
      const keyReq = { session_id: sid, content_hash: contentHash, message_index: msgIndex };
      const busy = await this._busyReplyForRequest(keyReq, sid);
      if (busy) return busy;
      const key = this._jobKey(keyReq, sid);
      this._messageBusyKeys.add(key);
      const cards = [];
      const replaced = [];
      const failed = [];
      try {
      for (const item of targets) {
        const row = item.row;
        try {
          const result = await this.rerollCard(row.id, "nai", null, { skipBusyCheck: true });
          if (result?.busy) {
            failed.push({ id: row.id, error: result.error?.message || "busy" });
            break;
          }
          if (result?.ok && result.card) {
            cards.push(result.card);
            if (result.replaced) replaced.push(result.replaced);
          } else {
            failed.push({ id: row.id, error: cleanText(result?.error?.message || "reroll failed", 400) });
          }
        } catch (error) {
          failed.push({ id: row.id, error: cleanText(error?.message || error, 400) });
        }
      }
      return { ok: cards.length > 0, count: cards.length, replaced, cards, failed };
      } finally {
        this._messageBusyKeys.delete(key);
      }
    }

    async testLlm(overrides = null) {
      if (overrides) {
        const llm = { ...overrides };
        if (cleanText(llm.api_key)) {
          this.config.llm = this.config.llm || {};
          this.config.llm.api_key = cleanText(llm.api_key);
          delete llm.api_key;
        } else delete llm.api_key;
        delete llm.api_key_configured;
        if (cleanText(llm.service_account_json)) {
          this.config.llm = this.config.llm || {};
          this.config.llm.service_account_json = cleanText(llm.service_account_json);
          delete llm.service_account_json;
        } else delete llm.service_account_json;
        delete llm.service_account_configured;
        if (Object.keys(llm).length) this.config.llm = deepMerge(this.config.llm || {}, llm);
        await this.saveConfig();
      }
      try {
        const cfg = this.config.llm || {};
        const source = normalizeLlmSource(cfg.source);
        const provider = llmHelpers().normalizeLlmProvider?.(cfg.provider) || normalizeLlmProviderFallback(cfg.provider);
        if (source === "custom" && !llmConfigured(cfg)) {
          return {
            ok: false,
            message: provider === "vertex"
              ? "Vertex AI: Model + Service Account JSON(또는 access token)이 필요합니다."
              : "태깅 LLM Model/API key가 비어 있습니다. NovelAI 키가 아니라 태깅용 LLM 키를 넣으세요.",
          };
        }
        if ((source === "main" || source === "aux") && typeof (globalThis.risuai || globalThis.Risuai)?.runLLMModel !== "function") {
          return { ok: false, message: "RisuAI runLLMModel API를 사용할 수 없습니다." };
        }
        const text = await this.callLlm([{ role: "user", content: "Reply with exactly: ok" }]);
        return { ok: true, message: `LLM ok (${source}): ${text.slice(0, 120)}` };
      } catch (exc) {
        return { ok: false, message: String(exc?.message || exc) };
      }
    }

    async testNai() {
      const nai = this.config.nai || {};
      if (imageBackendKind(nai) === "comfy") {
        try {
          if (!comfyConfigured(nai)) {
            return { ok: false, message: "ComfyUI 워크플로 JSON이 없습니다.", debug: debugSnapshot() };
          }
          // Validate placeholders without submitting a job.
          const values = buildComfyPlaceholderValues({
            main: "test",
            neg: "test",
            captions: [{ prompt: "char1" }, { prompt: "char2" }],
            nai,
            seed: 1,
          });
          const wf = buildComfyWorkflowFromTemplate(nai.comfy_workflow_json, values);
          const baseUrl = comfyBaseUrl(nai);
          const { status, data } = await fetchJsonCompat(`${baseUrl}/system_stats`, { method: "GET" });
          if (status >= 400) {
            return {
              ok: false,
              message: `ComfyUI 연결 실패 (HTTP ${status}) · ${baseUrl}`,
              debug: debugSnapshot(),
            };
          }
          const device = data?.devices?.[0]?.name || data?.system?.os || "ok";
          return {
            ok: true,
            message: `ComfyUI ok · ${baseUrl} · nodes=${Object.keys(wf).length} · ${device}`,
            debug: { last_stage: debugLastStage, events: debugEvents.slice(-20) },
          };
        } catch (exc) {
          dbg("comfy.test", { message: String(exc?.message || exc) }, "error");
          return { ok: false, message: String(exc?.message || exc), debug: debugSnapshot() };
        }
      }
      if (!cleanText(nai.api_key)) return { ok: false, message: "NAI api_key missing", debug: debugSnapshot() };
      try {
        const token = cleanText(nai.api_key);
        try {
          const span = dbgSpan("nai.test.anlas");
          const anlas = await getAnlas(token);
          span.end({ message: "anlas ok" });
          return { ok: true, message: `NAI token ok · Anlas=${JSON.stringify(anlas)}`, debug: { last_stage: debugLastStage, events: debugEvents.slice(-20) } };
        } catch (exc) {
          const model = modelToNaia(nai.model || "nai-diffusion-4-5-full");
          dbg("nai.test.anlas", { message: String(exc?.message || exc) }, "warn");
          return { ok: true, message: `NAI config present · model=${model} · anlas_skip=${exc?.message || exc}`, debug: { last_stage: debugLastStage, events: debugEvents.slice(-20) } };
        }
      } catch (exc) {
        dbg("nai.test", { message: String(exc?.message || exc) }, "error");
        return { ok: false, message: String(exc?.message || exc), debug: debugSnapshot() };
      }
    }

    /** Minimal 1-shot NAI generate to locate hang vs auth vs unzip failures. */
    async probeNaiGenerate() {
      const nai = this.config.nai || {};
      const token = cleanText(nai.api_key);
      if (!token) return { ok: false, message: "NAI api_key missing", debug: debugSnapshot() };
      const prevCtx = debugJobCtx;
      debugJobCtx = "probe-nai";
      const span = dbgSpan("nai.probe");
      try {
        dbg("nai.probe.start", { message: "tiny generate" });
        const req = {
          prompt: "1girl, solo, simple background, best quality",
          negative_prompt: "lowres, bad quality",
          width: 512,
          height: 768,
          steps: 10,
          cfg_scale: 5,
          cfg_rescale: 0,
          sampler: "k_euler_ancestral",
          scheduler: "karras",
          model: modelToNaia(nai.model || "nai-diffusion-4-5-full"),
          var_plus: false,
          characters: [],
          seed: Math.floor(Math.random() * 4294967295) || 1,
        };
        const apiUrl = cleanText(nai.request_url) || API_URL;
        const result = await withGenerateMutex(async () => generateT2i(token, req, apiUrl, { timeoutMs: 90000 }));
        const bytes = result.raw_bytes?.byteLength || 0;
        const isPng = isPngBytes(new Uint8Array(result.raw_bytes || []));
        span.end({ bytes, is_png: isPng, seed: result.seed });
        return {
          ok: true,
          message: `probe ok · png=${isPng} · ${bytes}B · seed=${result.seed}`,
          bytes,
          is_png: isPng,
          seed: result.seed,
          debug: debugSnapshot(),
        };
      } catch (exc) {
        span.fail(exc);
        return { ok: false, message: String(exc?.message || exc), debug: debugSnapshot() };
      } finally {
        debugJobCtx = prevCtx;
      }
    }

    async prepareAutotagImage(imageBytes) {
      let u8 = asU8(imageBytes);
      if (!u8.length) throw new Error("image is empty");
      // Donmai autotagger + Risu nativeFetch log path hate multi-MB pastes.
      // Downscale like Tampermonkey's canvas path (display-sized), keep PNG.
      const maxEdge = 1536;
      const maxBytes = 1_200_000;
      const mime = sniffImageMime(u8);
      const needsShrink = u8.length > maxBytes;
      try {
        const blob = new Blob([u8], { type: mime });
        let bitmap = null;
        if (typeof createImageBitmap === "function") bitmap = await createImageBitmap(blob);
        if (bitmap && (needsShrink || bitmap.width > maxEdge || bitmap.height > maxEdge)) {
          const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1));
          const w = Math.max(1, Math.round(bitmap.width * scale));
          const h = Math.max(1, Math.round(bitmap.height * scale));
          if (typeof document !== "undefined") {
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(bitmap, 0, 0, w, h);
              const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
              if (outBlob) {
                u8 = new Uint8Array(await outBlob.arrayBuffer());
                try {
                  bitmap.close?.();
                } catch (_) {}
                return { bytes: u8, mime: "image/png", filename: "image.png" };
              }
            }
          }
        }
        try {
          bitmap?.close?.();
        } catch (_) {}
      } catch (err) {
        dbg("autotag.resize", { message: String(err?.message || err) }, "warn");
      }
      const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
      return { bytes: u8, mime, filename: `image.${ext}` };
    }

    async evaluateAutotag(imageBytes, threshold = 0.2) {
      if (!imageBytes?.byteLength && !(imageBytes instanceof Uint8Array && imageBytes.length)) {
        throw new Error("image is empty");
      }
      // threshold kept for API compat; LLM path does not use WD score cutoff.
      void threshold;
      const prepared = await this.prepareAutotagImage(imageBytes);
      const u8 = prepared.bytes;
      const mime = prepared.mime || "image/png";
      const filename = prepared.filename || "image.png";
      const b64 = await bytesToBase64Async(u8);
      const dataUrl = `data:${mime};base64,${b64}`;
      const prompt = stripCbs(await this.getPrompt("autotag")) || [
        "Tag ONE character reference image into Danbooru-style English prompts.",
        'Return ONE JSON object only: {"appearance":"...","attire":"...","accessories":"..."}.',
        "appearance = identity/hair/eyes/body (no clothes). attire = clothing only. accessories = jewelry/props/earbuds/etc.",
      ].join("\n");
      dbg("autotag.start", {
        message: `llm-vision ${filename} ${u8.length}B`,
        bytes: u8.length,
        focus: true,
        source: normalizeLlmSource(this.config?.llm?.source),
      });
      const messages = [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Tag this character image. JSON only with appearance, attire, accessories." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ];
      let raw = "";
      try {
        raw = await this.callLlm(messages);
      } catch (err) {
        dbg("autotag.llm.fail", { message: String(err?.message || err) }, "error");
        throw new Error(`오토태그 LLM 실패: ${String(err?.message || err).slice(0, 240)}`);
      }
      const VC = globalThis.__INLAY_VIEWER_CORE__;
      const parsed = typeof VC?.parseAutotagLookJson === "function"
        ? VC.parseAutotagLookJson(raw)
        : (() => {
          try {
            const m = String(raw || "").match(/\{[\s\S]*\}/);
            const obj = m ? JSON.parse(m[0]) : null;
            return {
              appearance: cleanText(obj?.appearance || "", 4000),
              attire: cleanText(obj?.attire || "", 4000),
              accessories: cleanText(obj?.accessories || "", 4000),
              text: cleanText([obj?.appearance, obj?.attire, obj?.accessories].filter(Boolean).join(", "), 8000),
            };
          } catch {
            return { appearance: cleanText(raw, 4000), attire: "", accessories: "", text: cleanText(raw, 8000) };
          }
        })();
      const appearance = cleanText(parsed.appearance || "", 4000);
      const attire = cleanText(parsed.attire || "", 4000);
      const accessories = cleanText(parsed.accessories || "", 4000);
      const text = cleanText(parsed.text || [appearance, attire, accessories].filter(Boolean).join(", "), 8000);
      if (!appearance && !attire && !accessories) {
        throw new Error("LLM이 외형/의상/악세사리 태그를 반환하지 않았습니다. 비전(이미지) 지원 모델인지 확인하세요.");
      }
      const tags = text.split(",").map((t) => t.trim()).filter(Boolean);
      dbg("autotag.done", {
        message: `app=${appearance.length} attire=${attire.length} acc=${accessories.length}`,
        focus: true,
      });
      return {
        ok: true,
        appearance,
        attire,
        accessories,
        tags,
        text,
        count: tags.length,
        threshold: Number(threshold || 0.2),
        engine: "llm-vision",
      };
    }
  }

  function parseQuery(path) {
    const qIdx = path.indexOf("?");
    if (qIdx < 0) return { pathname: path, query: {} };
    const pathname = path.slice(0, qIdx);
    const params = new URLSearchParams(path.slice(qIdx + 1));
    const query = {};
    for (const [k, v] of params.entries()) {
      if (!(k in query)) query[k] = v;
      else if (Array.isArray(query[k])) query[k].push(v);
      else query[k] = [query[k], v];
    }
    return { pathname, query };
  }

  function authorized(config, headers = {}) {
    const expected = cleanText(config.auth_token, 4000);
    if (!expected) return true;
    let authorization = headers.Authorization || headers.authorization || "";
    let supplied = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7) : authorization;
    supplied = supplied || headers["X-Inlay-Nexus-Token"] || headers["x-inlay-nexus-token"] || "";
    if (typeof supplied !== "string") return false;
    if (supplied.length !== expected.length) return false;
    let ok = 0;
    for (let i = 0; i < expected.length; i++) ok |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
    return ok === 0;
  }

  async function routeFetch(path, options = {}) {
    const { pathname, query } = parseQuery(path);
    const method = String(options.method || "GET").toUpperCase();
    let body = options.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {
        body = {};
      }
    } else if (body == null) body = {};

    if (["/v1/health", "/healthz", "/readyz"].includes(pathname) || (method !== "GET" && pathname === "/v1/health")) {
      return { status: 200, data: { ok: true, health: nexus.health() } };
    }
    if (pathname === "/v1/debug" || pathname === "/v1/debug/log") {
      if (method === "DELETE" || (method === "POST" && body?.clear)) {
        debugEvents.length = 0;
        debugLastError = null;
        debugLastStage = "cleared";
        return { status: 200, data: { ok: true, cleared: true } };
      }
      return { status: 200, data: debugSnapshot() };
    }
    if (!authorized(nexus.config, options.headers || {})) {
      throw makeFetchError(401, { ok: false, error: { code: "unauthorized", message: "invalid token" } }, "invalid token");
    }

    if (method === "GET") {
      if (pathname === "/v1/debug") return { status: 200, data: debugSnapshot() };
      if (pathname === "/v1/settings/export") return { status: 200, data: { ok: true, json: nexus.exportSettingsJson() } };
      if (pathname === "/v1/settings") return { status: 200, data: { ok: true, settings: nexus.publicSettings() } };
      if (pathname === "/v1/prompts") return { status: 200, data: { ok: true, prompts: await nexus.listPrompts() } };
      if (pathname.startsWith("/v1/prompts/")) {
        const key = pathname.split("/v1/prompts/", 2)[1];
        return { status: 200, data: { ok: true, key, text: await nexus.getPrompt(key) } };
      }
      if (pathname.startsWith("/v1/jobs/")) return { status: 200, data: await nexus.getJob(pathname.split("/v1/jobs/", 2)[1]) };
      if (pathname.startsWith("/v1/gallery/explore")) {
        const limit = Number(Array.isArray(query.limit) ? query.limit[0] : query.limit || 400);
        return { status: 200, data: await nexus.galleryExplore(limit) };
      }
      if (pathname === "/v1/gallery/favorites") {
        return { status: 200, data: await nexus.getExplorerFavorites() };
      }
      if (pathname.startsWith("/v1/gallery")) {
        const sessionId = Array.isArray(query.session_id) ? query.session_id[0] : query.session_id || "";
        const limit = Number(Array.isArray(query.limit) ? query.limit[0] : query.limit || 40);
        return { status: 200, data: await nexus.gallery(sessionId, limit) };
      }
      if (pathname === "/v1/nai/reference.png") {
        const data = await nexus.getReferenceImageBytes();
        if (!data) throw makeFetchError(404, { ok: false, error: { code: "not_found", message: "no reference" } }, "no reference");
        return { status: 200, data, contentType: "image/png", raw: true };
      }
      if (pathname === "/v1/nai/vibe.png") {
        const data = await nexus.getVibeImageBytes();
        if (!data) throw makeFetchError(404, { ok: false, error: { code: "not_found", message: "no vibe" } }, "no vibe");
        return { status: 200, data, contentType: "image/png", raw: true };
      }
      if (pathname === "/v1/nai/reference") {
        return {
          status: 200,
          data: {
            ok: true,
            configured: await nexus.hasReferenceImage(),
            image_reference: nexus.config.nai?.image_reference || "none",
            preview_url: (await nexus.hasReferenceImage()) ? "/v1/nai/reference.png" : "",
          },
        };
      }
      if (pathname === "/v1/nai/vibe") {
        return {
          status: 200,
          data: {
            ok: true,
            configured: await nexus.hasVibeTransfer(),
            vibe_transfer: nexus.config.nai?.vibe_transfer || "none",
            preview_url: (await nexus.hasVibeTransfer()) ? "/v1/nai/vibe.png" : "",
          },
        };
      }
      if (pathname.startsWith("/v1/characters")) {
        const sessionId = Array.isArray(query.session_id) ? query.session_id[0] : query.session_id || "";
        const characterId = Array.isArray(query.character_id) ? query.character_id[0] : query.character_id || "";
        return { status: 200, data: await nexus.getCharactersPayload(sessionId, characterId) };
      }
      if (pathname.startsWith("/v1/appearance/")) {
        const sessionId = pathname.split("/v1/appearance/", 2)[1];
        return { status: 200, data: await nexus.getCharactersPayload(sessionId) };
      }
      if (pathname.startsWith("/v1/images/")) {
        let cardId = pathname.split("/v1/images/", 2)[1].replace(/^\/+|\/+$/g, "");
        if (cardId.endsWith(".json")) {
          const imageId = cardId.slice(0, -".json".length);
          const loc = await nexus.readImageLocation(imageId);
          if (!Object.keys(loc).length) throw makeFetchError(404, { ok: false, error: { code: "not_found", message: "location missing" } }, "location missing");
          return { status: 200, data: loc };
        }
        if (cardId.endsWith(".png")) cardId = cardId.slice(0, -".png".length);
        const data = await nexus.getImageBytes(cardId);
        if (!data) throw makeFetchError(404, { ok: false, error: { code: "not_found", message: "image missing" } }, "image missing");
        return { status: 200, data, contentType: "image/png", raw: true };
      }
      throw makeFetchError(404, { ok: false, error: { code: "not_found", message: pathname } }, pathname);
    }

    if (["POST", "PUT", "PATCH"].includes(method)) {
      try {
      if (pathname === "/v1/settings/reset") return { status: 200, data: await nexus.resetSettings() };
      if (pathname === "/v1/settings/import") return { status: 200, data: await nexus.importSettingsJson(body.json || body.text || "") };
      if (pathname === "/v1/settings" || pathname === "/v1/settings/update") return { status: 200, data: await nexus.updateSettings(body) };
      if (pathname.startsWith("/v1/prompts/") && pathname.endsWith("/reset")) {
        const key = pathname.slice("/v1/prompts/".length, -"/reset".length);
        return { status: 200, data: await nexus.setPrompt(key, promptText(key)) };
      }
      if (pathname.startsWith("/v1/prompts/")) {
        const key = pathname.split("/v1/prompts/", 2)[1];
        return { status: 200, data: await nexus.setPrompt(key, body.text || "") };
      }
      if (pathname === "/v1/jobs/create" || pathname === "/v1/jobs") return { status: 202, data: await nexus.createJob(body) };
      if (pathname === "/v1/gallery/unlink" || pathname === "/v1/cards/unlink") {
        return { status: 200, data: await nexus.unlinkCardsForMessage(body.session_id || "", body.content_hash || "", body.message_index) };
      }
      if (pathname === "/v1/gallery/rebind-hash" || pathname === "/v1/cards/rebind-hash") {
        return {
          status: 200,
          data: await nexus.rebindCardsHash({
            session_id: body.session_id || body.sessionId || "",
            card_ids: body.card_ids || body.ids || [],
            to_hash: body.to_hash || body.content_hash || "",
            assistant_preview: body.assistant_preview || body.assistant_text || "",
          }),
        };
      }
      if (pathname === "/v1/gallery/delete" || pathname === "/v1/cards/delete") {
        const folderKey = cleanText(body.folder_key || "", 400);
        const cardId = cleanText(body.card_id || body.id || "", 80);
        const cardIds = Array.isArray(body.card_ids) ? body.card_ids : null;
        if (folderKey) return { status: 200, data: await nexus.deleteFolder(folderKey) };
        if (cardIds?.length) return { status: 200, data: await nexus.deleteCards(cardIds) };
        if (cardId) return { status: 200, data: await nexus.deleteCard(cardId) };
        throw makeFetchError(400, { ok: false, error: { code: "bad_request", message: "card_id or folder_key required" } }, "card_id or folder_key required");
      }
      if (pathname === "/v1/gallery/export") {
        return { status: 200, data: await nexus.exportGalleryZip(body || {}) };
      }
      if (pathname === "/v1/gallery/import") {
        return { status: 200, data: await nexus.importGalleryZip(body || {}) };
      }
      if (pathname === "/v1/gallery/favorites") {
        if (Array.isArray(body?.ids)) return { status: 200, data: await nexus.setExplorerFavorites(body.ids) };
        return { status: 200, data: await nexus.getExplorerFavorites() };
      }
      if (pathname.startsWith("/v1/cards/") && pathname.endsWith("/tags")) {
        const cardId = pathname.slice("/v1/cards/".length, -"/tags".length);
        return { status: 200, data: await nexus.updateCardTags(cardId, body) };
      }
      if (pathname.startsWith("/v1/cards/") && pathname.endsWith("/reroll")) {
        const cardId = pathname.slice("/v1/cards/".length, -"/reroll".length);
        return { status: 200, data: await nexus.rerollCard(cardId, body.mode || "nai", body.overrides) };
      }
      if (pathname === "/v1/messages/reroll" || pathname === "/v1/gallery/reroll-message") {
        return {
          status: 200,
          data: await nexus.rerollMessageCards({
            session_id: body.session_id || body.sessionId || "",
            content_hash: body.content_hash || body.contentHash || "",
            message_index: body.message_index ?? body.messageIndex ?? -1,
          }),
        };
      }
      if (pathname === "/v1/characters/global-toggles" || pathname === "/v1/characters/global_toggles") {
        return { status: 200, data: await nexus.setDisabledGlobals(body.character_id || "", body.disabled_globals || body.disabled || []) };
      }
      if (pathname === "/v1/characters/unify" || pathname === "/v1/characters/merge") {
        return {
          status: 200,
          data: await nexus.unifyCharacterSessions(
            body.target_session_id || body.session_id || "",
            body.source_session_ids || body.session_ids || [],
            body.include_target !== false,
          ),
        };
      }
      if (pathname === "/v1/characters" || pathname === "/v1/characters/update") {
        const sessionId = cleanText(body.session_id || "", 200);
        const characterId = cleanText(body.character_id || "", 200);
        // Unified view writes roots only (patch existing / delete matching). Never create-missing.
        const rootSessionIds = (
          Array.isArray(body.root_session_ids) ? body.root_session_ids
            : Array.isArray(body.cascade_session_ids) ? body.cascade_session_ids
              : []
        ).map((s) => cleanText(s, 200)).filter(Boolean);
        if ("characters" in body && sessionId) {
          await nexus.replaceCharacters(sessionId, body.characters || [], {
            prune: true,
            rootSessionIds,
          });
        }
        if ("global" in body) await nexus.replaceCharacters(GLOBAL_SCOPE, body.global || [], { prune: true });
        if ("character" in body) {
          const scope = cleanText(body.scope || sessionId || GLOBAL_SCOPE, 200);
          if (rootSessionIds.length && scope !== GLOBAL_SCOPE) {
            await nexus.patchExistingInSessions(rootSessionIds, [body.character || {}], "");
          } else {
            await nexus.upsertCharacter(scope, body.character || {});
          }
        }
        const deleteRefs = Array.isArray(body.root_delete) ? body.root_delete
          : Array.isArray(body.cascade_delete) ? body.cascade_delete
            : [];
        if (deleteRefs.length && rootSessionIds.length) {
          await nexus.deleteMatchingInSessions(rootSessionIds, deleteRefs, "");
        }
        // After root edits, refresh unified view cache if the request targeted it.
        if (rootSessionIds.length && sessionId) {
          await nexus.unifyCharacterSessions(sessionId, rootSessionIds, false);
        }
        return { status: 200, data: await nexus.getCharactersPayload(sessionId, characterId) };
      }
      if (pathname.startsWith("/v1/appearance/")) {
        const sessionId = pathname.split("/v1/appearance/", 2)[1];
        if (body.characters != null || body.global != null) {
          if (body.characters != null) await nexus.replaceCharacters(sessionId, body.characters || [], { prune: true });
          if (body.global != null) await nexus.replaceCharacters(GLOBAL_SCOPE, body.global || [], { prune: true });
          return { status: 200, data: await nexus.getCharactersPayload(sessionId) };
        }
        return { status: 200, data: await nexus.setAppearance(sessionId, body.appearance || {}) };
      }
      if (pathname === "/v1/models/test") return { status: 200, data: await nexus.testLlm(body.llm && typeof body.llm === "object" ? body.llm : null) };
      if (pathname === "/v1/nai/test") return { status: 200, data: await nexus.testNai() };
      if (pathname === "/v1/nai/probe" || pathname === "/v1/debug/probe-nai") {
        return { status: 200, data: await nexus.probeNaiGenerate() };
      }
      if (pathname === "/v1/debug" || pathname === "/v1/debug/clear") {
        if (body?.clear || pathname.endsWith("/clear")) {
          debugEvents.length = 0;
          debugLastError = null;
          debugLastStage = "cleared";
          return { status: 200, data: { ok: true, cleared: true } };
        }
        return { status: 200, data: debugSnapshot() };
      }
      if (pathname === "/v1/nai/reference" || pathname === "/v1/nai/reference/upload") {
        if (body.clear) return { status: 200, data: await nexus.clearReferenceImage() };
        let rawB64 = body.image_b64 || body.data || "";
        if (typeof rawB64 === "string" && rawB64.startsWith("data:")) rawB64 = rawB64.split(",", 2)[1];
        if (!cleanText(rawB64)) throw new Error("image_b64 required");
        return { status: 200, data: await nexus.setReferenceImage(base64ToBytes(rawB64).buffer) };
      }
      if (pathname === "/v1/nai/reference/clear") return { status: 200, data: await nexus.clearReferenceImage() };
      if (pathname === "/v1/nai/vibe" || pathname === "/v1/nai/vibe/upload") {
        if (body.clear) return { status: 200, data: await nexus.clearVibeTransfer() };
        let rawB64 = body.image_b64 || body.data || "";
        if (typeof rawB64 === "string" && rawB64.startsWith("data:")) rawB64 = rawB64.split(",", 2)[1];
        if (!cleanText(rawB64)) throw new Error("image_b64 required");
        return {
          status: 200,
          data: await nexus.setVibeTransfer(base64ToBytes(rawB64).buffer, {
            model: body.model,
            information_extracted: body.information_extracted ?? body.vibe_transfer_information_extracted,
            strength: body.strength ?? body.vibe_transfer_strength,
          }),
        };
      }
      if (pathname === "/v1/nai/vibe/clear") return { status: 200, data: await nexus.clearVibeTransfer() };
      if (pathname === "/v1/autotag" || pathname === "/v1/autotag/evaluate") {
        let rawB64 = body.image_b64 || body.data || "";
        if (typeof rawB64 === "string" && rawB64.startsWith("data:")) rawB64 = rawB64.split(",", 2)[1];
        rawB64 = String(rawB64 || "").replace(/\s+/g, "");
        if (!rawB64) throw new Error("image_b64 required");
        const bytes = base64ToBytes(rawB64);
        return {
          status: 200,
          data: await nexus.evaluateAutotag(u8ToArrayBuffer(bytes), Number(body.threshold ?? 0.2)),
        };
      }
      throw makeFetchError(404, { ok: false, error: { code: "not_found", message: pathname } }, pathname);
      } catch (exc) {
        if (exc.status) throw exc;
        throw makeFetchError(500, { ok: false, error: { code: "internal", message: String(exc?.message || exc) } }, String(exc?.message || exc));
      }
    }

    throw makeFetchError(405, { ok: false, error: { code: "method_not_allowed", message: method } }, method);
  }

  async function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        dbg("boot.ready.start", { message: VERSION });
        await openDb();
        const store = await getDeviceStore().catch((err) => {
          dbg("boot.storage", { message: String(err?.message || err) }, "error");
          throw err;
        });
        dbg("boot.storage", { message: store.kind });
        nexus = new InlayNexus();
        await nexus.init();
        dbg("boot.ready.done", {
          message: VERSION,
          has_nativeFetch: typeof globalThis.risuai?.nativeFetch === "function",
          has_idb: typeof globalThis.risuai?.getLocalPluginStorage === "function",
        });
      })().catch((error) => {
        readyPromise = null;
        nexus = null;
        throw error;
      });
    }
    await readyPromise;
    return true;
  }

  async function fetch(path, options = {}, timeoutMs = 120000) {
    await ready();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort?.(), timeoutMs);
    try {
      const result = await routeFetch(path, { ...options, signal: controller?.signal });
      if (result.raw) return result.data;
      if (result.status >= 400) throw makeFetchError(result.status, result.data);
      return result.data;
    } catch (err) {
      if (err.status) throw err;
      throw makeFetchError(500, { ok: false, error: { code: "internal", message: String(err?.message || err) } }, String(err?.message || err));
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureImageUrl(id) {
    await ready();
    return ensureBlobUrl(id);
  }

  globalThis.__INLAY_NATIVE__ = {
    VERSION,
    ready,
    fetch,
    resolveImageUrl,
    refPreviewUrl,
    vibePreviewUrl,
    ensureImageUrl,
    warmImages,
    debug: debugSnapshot,
    clearDebug() {
      debugEvents.length = 0;
      debugLastError = null;
      debugLastStage = "cleared";
      return true;
    },
  };

  dbg("boot.loaded", { message: VERSION });
})();
