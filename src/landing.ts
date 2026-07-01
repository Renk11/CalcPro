import './landing.css';

declare global {
  interface Window {
    VK?: {
      init?: (options: { apiId: number; onlyWidgets?: boolean }) => void;
      Widgets?: {
        CommunityMessages?: (
          elementId: string,
          groupId: number,
          options?: Record<string, string | number | boolean>,
        ) => void;
      };
    };
  }
}

const VK_WIDGET_APP_ID = 54626522;
const VK_WIDGET_GROUP_ID = 239808218;
const VK_WIDGET_CONTAINER_ID = 'vk-community-messages';
const VK_WIDGET_SCRIPT_ID = 'vk-openapi-script';
const VK_WIDGET_SCRIPT_SRC = 'https://vk.com/js/api/openapi.js?169';
const VK_WIDGET_FALLBACK_LINK_ID = 'vk-community-messages-fallback';
const VK_WIDGET_LOAD_TIMEOUT_MS = 8000;

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

const showcaseCarousel = document.querySelector<HTMLElement>('[data-showcase-carousel]');
const showcasePrevButton = document.querySelector<HTMLButtonElement>('[data-showcase-prev]');
const showcaseNextButton = document.querySelector<HTMLButtonElement>('[data-showcase-next]');
const showcaseDots = document.querySelector<HTMLElement>('[data-showcase-dots]');

if (showcaseCarousel && showcasePrevButton && showcaseNextButton && showcaseDots) {
  const slides = Array.from(
    showcaseCarousel.querySelectorAll<HTMLElement>('[data-showcase-slide]'),
  );

  if (slides.length > 0) {
    const dotButtons = slides.map((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'landing-showcase-dots__button';
      dot.setAttribute('aria-label', `Перейти к экрану ${index + 1}`);
      dot.addEventListener('click', () => {
        const targetSlide = slides[index];
        showcaseCarousel.scrollTo({
          left: targetSlide.offsetLeft,
          behavior: 'smooth',
        });
      });
      showcaseDots.appendChild(dot);
      return dot;
    });

    const getActiveSlideIndex = () => {
      const currentScroll = showcaseCarousel.scrollLeft + showcaseCarousel.clientWidth / 2;
      let activeIndex = 0;
      let minDistance = Number.POSITIVE_INFINITY;

      slides.forEach((slide, index) => {
        const slideCenter = slide.offsetLeft + slide.clientWidth / 2;
        const distance = Math.abs(slideCenter - currentScroll);
        if (distance < minDistance) {
          minDistance = distance;
          activeIndex = index;
        }
      });

      return activeIndex;
    };

    const updateShowcaseControls = () => {
      const activeIndex = getActiveSlideIndex();

      dotButtons.forEach((button, index) => {
        button.classList.toggle('landing-showcase-dots__button_active', index === activeIndex);
      });

      showcasePrevButton.disabled = activeIndex === 0;
      showcaseNextButton.disabled = activeIndex === slides.length - 1;
    };

    const scrollToRelativeSlide = (direction: -1 | 1) => {
      const nextIndex = Math.min(
        slides.length - 1,
        Math.max(0, getActiveSlideIndex() + direction),
      );
      showcaseCarousel.scrollTo({
        left: slides[nextIndex].offsetLeft,
        behavior: 'smooth',
      });
    };

    showcasePrevButton.addEventListener('click', () => {
      scrollToRelativeSlide(-1);
    });

    showcaseNextButton.addEventListener('click', () => {
      scrollToRelativeSlide(1);
    });

    showcaseCarousel.addEventListener('scroll', () => {
      window.requestAnimationFrame(updateShowcaseControls);
    });

    window.addEventListener('resize', updateShowcaseControls);
    updateShowcaseControls();
  }
}

const loadVkWidgetScript = () =>
  new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('VK Open API load timeout'));
    }, VK_WIDGET_LOAD_TIMEOUT_MS);

    const resolveWithCleanup = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };

    const rejectWithCleanup = (error: Error) => {
      window.clearTimeout(timeoutId);
      reject(error);
    };

    const existingScript = document.getElementById(VK_WIDGET_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      if (window.VK?.Widgets?.CommunityMessages) {
        resolveWithCleanup();
        return;
      }

      existingScript.addEventListener('load', () => resolveWithCleanup(), { once: true });
      existingScript.addEventListener(
        'error',
        () => rejectWithCleanup(new Error('VK Open API failed to load')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.id = VK_WIDGET_SCRIPT_ID;
    script.src = VK_WIDGET_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolveWithCleanup();
    script.onerror = () => rejectWithCleanup(new Error('VK Open API failed to load'));
    document.head.appendChild(script);
  });

const initVkCommunityMessagesWidget = async () => {
  const widgetHost = document.getElementById(VK_WIDGET_CONTAINER_ID);
  const fallbackLink = document.getElementById(VK_WIDGET_FALLBACK_LINK_ID);
  if (!widgetHost) {
    return;
  }

  try {
    await loadVkWidgetScript();

    if (!window.VK?.init || !window.VK?.Widgets?.CommunityMessages) {
      throw new Error('VK widget API is unavailable');
    }

    window.VK.init({ apiId: VK_WIDGET_APP_ID, onlyWidgets: true });
    window.VK.Widgets.CommunityMessages(VK_WIDGET_CONTAINER_ID, VK_WIDGET_GROUP_ID, {
      tooltipButtonText: 'Напишите нам в VK',
      expandTimeout: 10000,
      disableExpandChatSound: true,
    });

    widgetHost.dataset.widgetState = 'ready';
  } catch (_) {
    widgetHost.dataset.widgetState = 'failed';
    fallbackLink?.removeAttribute('hidden');
  }
};

void initVkCommunityMessagesWidget();
