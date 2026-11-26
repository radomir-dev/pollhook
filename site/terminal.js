const STEPS = [
  {
    cmd: 'pollhook init --repo acme/app --events workflow_run,pull_request',
    typeSpeed: 22,
    pauseBeforeOutput: 300,
    outputHtml: '<span class="t-line t-out">wrote /home/you/.config/pollhook/config.json</span>\n<span class="t-line t-out">next: pollhook status</span>',
    pauseAfter: 900,
  },
  {
    cmd: 'pollhook run 1234567890',
    typeSpeed: 22,
    pauseBeforeOutput: 1200,
    outputHtml: '<span class="t-line t-out">{&quot;name&quot;:&quot;CI&quot;,&quot;conclusion&quot;:&quot;<span class="t-success">success</span>&quot;,&quot;head_sha&quot;:&quot;abc1234&quot;,&quot;url&quot;:&quot;https://github.com/acme/app/actions/runs/1234567890&quot;}</span>',
    pauseAfter: 600,
  },
  {
    cmd: 'echo $?',
    typeSpeed: 25,
    pauseBeforeOutput: 250,
    outputHtml: '<span class="t-line t-out"><span class="t-success">0</span></span>',
    pauseAfter: 900,
  },
  {
    cmd: 'pollhook emit --brief',
    typeSpeed: 22,
    pauseBeforeOutput: 500,
    lines: [
      {
        html: '<span class="t-line t-out">14:02:11 acme/app pull_request <span class="t-opened">opened</span> 42 Add retry to the uploader</span>',
        delay: 1500,
      },
      {
        html: '<span class="t-line t-out">14:03:48 acme/app workflow_run completed 1234567890 CI <span class="t-success">success</span></span>',
        delay: 1500,
      },
      {
        html: '<span class="t-line t-out">14:05:20 acme/app pull_request <span class="t-closed">closed</span> 42 Add retry to the uploader</span>',
        delay: 800,
      },
    ],
  },
];

function getFinalHtml() {
  return [
    '<span class="t-line"><span class="t-prompt">$ </span><span class="t-cmd">pollhook init --repo acme/app --events workflow_run,pull_request</span></span>',
    '<span class="t-line t-out">wrote /home/you/.config/pollhook/config.json</span>',
    '<span class="t-line t-out">next: pollhook status</span>',
    '<span class="t-line"><span class="t-prompt">$ </span><span class="t-cmd">pollhook run 1234567890</span></span>',
    '<span class="t-line t-out">{&quot;name&quot;:&quot;CI&quot;,&quot;conclusion&quot;:&quot;<span class="t-success">success</span>&quot;,&quot;head_sha&quot;:&quot;abc1234&quot;,&quot;url&quot;:&quot;https://github.com/acme/app/actions/runs/1234567890&quot;}</span>',
    '<span class="t-line"><span class="t-prompt">$ </span><span class="t-cmd">echo $?</span></span>',
    '<span class="t-line t-out"><span class="t-success">0</span></span>',
    '<span class="t-line"><span class="t-prompt">$ </span><span class="t-cmd">pollhook emit --brief</span></span>',
    '<span class="t-line t-out">14:02:11 acme/app pull_request <span class="t-opened">opened</span> 42 Add retry to the uploader</span>',
    '<span class="t-line t-out">14:03:48 acme/app workflow_run completed 1234567890 CI <span class="t-success">success</span></span>',
    '<span class="t-line t-out">14:05:20 acme/app pull_request <span class="t-closed">closed</span> 42 Add retry to the uploader</span>',
    '<span class="cursor" aria-hidden="true"></span>',
  ].join('\n');
}

(function initTerminal() {
  const terminal = document.getElementById('demo-terminal');
  if (!terminal) return;

  const codeEl = terminal.querySelector('.terminal-screen code');
  const replayBtn = terminal.querySelector('.terminal-replay');
  const isRecord = window.location.search.includes('record');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let currentRunId = 0;
  let isRunning = false;

  function sleep(ms, runId) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (runId !== currentRunId) reject(new Error('cancelled'));
        else resolve();
      }, ms);
    });
  }

  function finishDemo() {
    isRunning = false;
    if (isRecord) {
      window.__demoDone = true;
      document.body.classList.add('done');
    }
  }

  function showFinalState() {
    currentRunId += 1;
    codeEl.innerHTML = getFinalHtml();
    finishDemo();
  }

  async function playAnimation() {
    const runId = ++currentRunId;
    isRunning = true;
    codeEl.innerHTML = '';

    try {
      for (let i = 0; i < STEPS.length; i++) {
        const step = STEPS[i];

        const line = document.createElement('span');
        line.className = 't-line';
        line.innerHTML = '<span class="t-prompt">$ </span><span class="t-cmd"></span><span class="cursor" aria-hidden="true"></span>';
        codeEl.appendChild(line);

        const cmdSpan = line.querySelector('.t-cmd');
        const cursor = line.querySelector('.cursor');

        for (let c = 0; c < step.cmd.length; c++) {
          cmdSpan.textContent += step.cmd[c];
          await sleep(step.typeSpeed, runId);
        }

        cursor.remove();

        if (step.pauseBeforeOutput) {
          await sleep(step.pauseBeforeOutput, runId);
        }

        if (step.outputHtml) {
          codeEl.appendChild(document.createTextNode('\n'));
          const temp = document.createElement('div');
          temp.innerHTML = step.outputHtml;
          while (temp.firstChild) {
            codeEl.appendChild(temp.firstChild);
          }
        }

        if (step.lines) {
          for (const l of step.lines) {
            codeEl.appendChild(document.createTextNode('\n'));
            const temp = document.createElement('div');
            temp.innerHTML = l.html;
            while (temp.firstChild) {
              codeEl.appendChild(temp.firstChild);
            }
            await sleep(l.delay, runId);
          }
        }

        codeEl.appendChild(document.createTextNode('\n'));

        if (step.pauseAfter) {
          await sleep(step.pauseAfter, runId);
        }
      }

      const endCursor = document.createElement('span');
      endCursor.className = 'cursor';
      endCursor.setAttribute('aria-hidden', 'true');
      codeEl.appendChild(endCursor);

      finishDemo();

      if (!isRecord) {
        await sleep(8000, runId);
        playAnimation();
      }
    } catch {
      // Stopped by skip or reset
    }
  }

  if (replayBtn) {
    replayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playAnimation();
    });
  }

  terminal.addEventListener('click', (e) => {
    if (replayBtn && (e.target === replayBtn || replayBtn.contains(e.target))) return;
    if (isRunning) {
      showFinalState();
    }
  });

  if (prefersReduced) {
    showFinalState();
    return;
  }

  if (isRecord) {
    playAnimation();
  } else {
    codeEl.innerHTML = '';
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        playAnimation();
      }
    }, { threshold: 0.25 });
    observer.observe(terminal);
  }
})();
