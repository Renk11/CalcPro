import './landing.css';

const yearTarget = document.querySelector<HTMLElement>('[data-current-year]');
if (yearTarget) {
  yearTarget.textContent = String(new Date().getFullYear());
}

document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (event) => {
    const href = anchor.getAttribute('href');
    if (!href || href === '#') {
      return;
    }

    const target = document.querySelector<HTMLElement>(href);
    if (!target) {
      return;
    }

    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

document.querySelectorAll<HTMLElement>('[data-copy-email]').forEach((control) => {
  control.addEventListener('click', async () => {
    const email = control.dataset.copyEmail;
    if (!email) {
      return;
    }

    try {
      await navigator.clipboard.writeText(email);
      const previousText = control.textContent;
      control.textContent = 'Скопировано';

      window.setTimeout(() => {
        control.textContent = previousText;
      }, 1600);
    } catch (_) {
      window.prompt('Скопируйте почту вручную:', email);
    }
  });
});
