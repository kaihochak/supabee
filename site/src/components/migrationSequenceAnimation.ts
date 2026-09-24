type Action =
  | { type: 'hide' | 'show'; targets: string[] }
  | { type: 'move'; targets: string[]; y: number; show?: boolean }
  | { type: 'seed-success'; target: string }
  | { type: 'status'; target: string; kind: 'success'; y: number }
  | { type: 'strike'; target: string }
  | { type: 'label'; target: string; text: string };

type Phase = { actions: Action[]; waitAfter: number };
type DiagramElement = SVGElement | HTMLElement;

const pause = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));
const findNode = (svg: SVGElement, id: string) => svg.closest('figure')?.querySelector<DiagramElement>(`[data-node="${id}"]`) ?? null;
const run = (element: Element, frames: Keyframe[], duration = 520) =>
  element.animate(frames, { duration, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' }).finished.catch(() => undefined);

const setLoopTitle = (target: DiagramElement, value: string) => {
  const [brand, ...command] = value.split(' ');
  const brandElement = target.querySelector<HTMLElement>('[data-loop-brand]');
  const commandElement = target.querySelector<HTMLElement>('[data-loop-command]');
  if (!brandElement || !commandElement) return;
  brandElement.textContent = brand;
  brandElement.style.color = brand === 'supabee' ? 'var(--warning)' : 'var(--diagram-brand)';
  commandElement.textContent = ` ${command.join(' ')}`;
  const strike = target.querySelector<HTMLElement>('[data-loop-strike]');
  if (strike) {
    strike.getAnimations().forEach((animation) => animation.cancel());
    strike.style.transform = 'scaleX(0)';
  }
};

const reset = (svg: SVGElement) => {
  svg.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
  svg.style.opacity = '1';
  svg.querySelectorAll<SVGElement>('[data-sequence-node], [data-extra-node]').forEach((element) => {
    element.style.opacity = '0';
    element.style.transform = '';
    if (element.dataset.kind === 'connector') {
      element.style.strokeDasharray = '1';
      element.style.strokeDashoffset = '1';
    }
  });
  svg.querySelectorAll<SVGElement>('[data-seed-role]').forEach((element) => {
    element.style.fill = '';
    element.style.stroke = '';
  });
  svg.querySelectorAll<SVGElement>('[data-status-kind]').forEach((element) => {
    element.style.opacity = element.dataset.statusKind === svg.dataset.initialStatus ? '1' : '0';
  });
  const loopTitle = findNode(svg, 'loop-title') as HTMLElement | null;
  if (loopTitle?.dataset.initialText) {
    loopTitle.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    setLoopTitle(loopTitle, loopTitle.dataset.initialText);
    loopTitle.style.opacity = '1';
  }
};

const playEntrance = async (svg: SVGElement) => {
  let end = 0;
  svg.querySelectorAll<SVGElement>('[data-sequence-node]').forEach((element) => {
    const delay = Number(element.dataset.delay ?? 0);
    const connector = element.dataset.kind === 'connector';
    const duration = connector ? 260 : 380;
    end = Math.max(end, delay + duration);
    element.animate(
      connector
        ? [{ opacity: 1, strokeDashoffset: 1 }, { opacity: 1, strokeDashoffset: 0 }]
        : [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { delay, duration, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' },
    );
  });
  await pause(end + 500);
};

const applyAction = (svg: SVGElement, action: Action) => {
  if (action.type === 'strike') {
    const target = findNode(svg, action.target);
    const strike = target?.querySelector('[data-loop-strike]');
    return strike ? [run(strike, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 320)] : [];
  }

  if (action.type === 'label') {
    const target = findNode(svg, action.target);
    if (!target) return [];
    return [(async () => {
      await run(target, [{ opacity: 1 }, { opacity: 0 }], 220);
      setLoopTitle(target, action.text);
      await run(target, [{ opacity: 0 }, { opacity: 1 }], 260);
    })()];
  }

  if (action.type === 'hide' || action.type === 'show') {
    return action.targets.flatMap((id) => {
      const target = findNode(svg, id);
      if (!target) return [];
      if (action.type === 'show' && target.dataset.kind === 'connector') {
        return [run(target, [{ opacity: 0, strokeDashoffset: 1 }, { opacity: 1, strokeDashoffset: 0 }], 420)];
      }
      return [run(target, [{ opacity: action.type === 'hide' ? 1 : 0 }, { opacity: action.type === 'hide' ? 0 : 1 }], 420)];
    });
  }

  if (action.type === 'move') {
    return action.targets.flatMap((id) => {
      const target = findNode(svg, id);
      if (!target) return [];
      return [run(target, [
        { transform: 'translateY(0)', opacity: action.show ? 0 : 1 },
        { transform: `translateY(${action.y}px)`, opacity: 1 },
      ], 720)];
    });
  }

  if (action.type === 'seed-success') {
    const target = findNode(svg, action.target);
    if (!target) return [];
    const surface = target.querySelector('[data-seed-role="surface"]');
    const icons = target.querySelectorAll('[data-seed-role="icon"]');
    const text = target.querySelector('[data-seed-role="text"]');
    return [
      surface ? run(surface, [
        { fill: 'color-mix(in oklab, var(--danger) 12%, var(--card))', stroke: 'var(--danger)' },
        { fill: 'color-mix(in oklab, var(--success) 12%, var(--card))', stroke: 'var(--success)' },
      ]) : Promise.resolve(),
      ...Array.from(icons, (icon) => run(icon, [
        { stroke: 'var(--danger)' },
        { stroke: 'var(--success)' },
      ])),
      text ? run(text, [
        { fill: 'var(--danger)' },
        { fill: 'var(--success)' },
      ]) : Promise.resolve(),
    ];
  }

  const target = findNode(svg, action.target);
  if (!target) return [];
  const conflict = target.querySelector('[data-status-kind="conflict"]');
  const success = target.querySelector('[data-status-kind="success"]');
  return [
    run(target, [{ opacity: 0, transform: 'translateY(0)' }, { opacity: 1, transform: `translateY(${action.y}px)` }], 520),
    conflict ? run(conflict, [{ opacity: 1 }, { opacity: 0 }], 320) : Promise.resolve(),
    success ? run(success, [{ opacity: 0 }, { opacity: 1 }], 320) : Promise.resolve(),
  ];
};

const playLoop = async (svg: SVGElement) => {
  const phases = JSON.parse(svg.dataset.phases || '[]') as Phase[];
  while (svg.isConnected) {
    reset(svg);
    await playEntrance(svg);
    await pause(700);
    for (const phase of phases) {
      await Promise.all(phase.actions.flatMap((action) => applyAction(svg, action)));
      await pause(phase.waitAfter);
    }
    if (phases.length === 0) await pause(1200);
    if (svg.dataset.keepStatic !== 'true') {
      await run(svg, [{ opacity: 1 }, { opacity: 0 }], 280);
      await pause(120);
    }
  }
};

export const setupMigrationSequences = () => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll<SVGElement>('[data-migration-sequence]:not([data-ready])').forEach((svg) => {
    svg.dataset.ready = 'true';
    if (reduceMotion) return;
    new IntersectionObserver(([entry], observer) => {
      if (!entry.isIntersecting) return;
      void playLoop(svg);
      observer.disconnect();
    }, { threshold: .2 }).observe(svg);
  });
};
