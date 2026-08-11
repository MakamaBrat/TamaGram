import { useEffect, useRef } from 'react';

// Renders a Telegram custom emoji stored by the bot webhook. Custom emoji
// come in two physical formats from Telegram itself:
//  - "webm": a short looping video — trivial, just <video>.
//  - "tgs": a gzipped Lottie JSON animation — needs to be inflated and
//    handed to lottie-web to play.
// `type` comes straight from pets.custom_emoji_type (see
// migration_add_pet_custom_emoji.sql).
export default function CustomEmojiFace({ url, type, className }) {
  if (type === 'webm') {
    return (
      <video
        className={className}
        src={url}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
      />
    );
  }
  return <TgsPlayer url={url} className={className} />;
}

function TgsPlayer({ url, className }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let anim;
    let cancelled = false;

    (async () => {
      const [{ default: lottie }, pako] = await Promise.all([
        import('lottie-web'),
        import('pako'),
      ]);
      const res = await fetch(url);
      const compressed = new Uint8Array(await res.arrayBuffer());
      const json = JSON.parse(pako.inflate(compressed, { to: 'string' }));

      if (cancelled || !containerRef.current) return;
      anim = lottie.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: json,
      });
    })();

    return () => {
      cancelled = true;
      if (anim) anim.destroy();
    };
  }, [url]);

  return <div ref={containerRef} className={className} />;
}
