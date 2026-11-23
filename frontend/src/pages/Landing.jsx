import React, { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowRight,
  Activity,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Compass,
  MapPinned,
  MessageCircle,
  PackageOpen,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ACCESS_PAGE_PATHS } from "../accessPages";
import { useAuth } from "../context/AuthContext";

const highlights = [
  {
    icon: BarChart3,
    title: "See the whole picture",
    description:
      "Bring revenue, orders, reviews, and customer behavior together in one clear view.",
    path: "/dashboard",
  },
  {
    icon: UsersRound,
    title: "Know your customers",
    description:
      "Explore customer profiles, purchase histories, and the patterns behind loyalty.",
    path: "/customers",
  },
  {
    icon: Sparkles,
    title: "Ask better questions",
    description:
      "Use Nova to turn plain-language questions into useful, data-backed answers.",
    path: "/assistant",
  },
];

const productAreas = [
  {
    icon: UsersRound,
    title: "Customer profiles",
    description:
      "Bring customer details together with their orders, reviews, and interactions for more useful context.",
    label: "CUSTOMER VIEW",
    tone: "violet",
    path: "/customers",
  },
  {
    icon: TrendingUp,
    title: "Business analytics",
    description:
      "Explore revenue, order activity, product trends, and customer patterns through focused views.",
    label: "ANALYTICS",
    tone: "teal",
    path: "/analytics",
  },
  {
    icon: MessageCircle,
    title: "Nova, your AI assistant",
    description:
      "Ask questions in everyday language and get answers grounded in the business data available to your account.",
    label: "ASK NOVA",
    tone: "amber",
    path: "/assistant",
  },
  {
    icon: PackageOpen,
    title: "Products and orders",
    description:
      "Follow the connection between what customers buy, how orders progress, and what they say afterward.",
    label: "PURCHASE JOURNEY",
    tone: "blue",
    path: "/products",
  },
];

function scrollToSection(event) {
  const sectionId = event.currentTarget.getAttribute("href")?.slice(1);
  const section = sectionId && document.getElementById(sectionId);
  if (!section) return;

  event.preventDefault();
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  section.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
  window.history.pushState(null, "", `#${sectionId}`);
}

export default function Landing() {
  const homeRef = useRef(null);
  const { isAuthenticated, hasAccess } = useAuth();
  const workspacePath =
    ACCESS_PAGE_PATHS.find(({ key }) => hasAccess(key))?.path || "/login";
  const primaryHref = isAuthenticated ? workspacePath : "/login";
  const primaryLabel = isAuthenticated ? "Go to workspace" : "Sign in";

  useEffect(() => {
    const home = homeRef.current;
    if (!home) return;

    const scrollRoot = document.documentElement;
    const handleScrollbarPointerMove = (event) => {
      const hasVerticalScrollbar = scrollRoot.scrollHeight > scrollRoot.clientHeight;
      const scrollbarWidth = Math.max(window.innerWidth - scrollRoot.clientWidth, 10);
      const pointerOverScrollbar =
        hasVerticalScrollbar && event.clientX >= window.innerWidth - scrollbarWidth;
      scrollRoot.classList.toggle("publicScrollbarHover", pointerOverScrollbar);
    };
    const clearScrollbarHover = () => {
      scrollRoot.classList.remove("publicScrollbarHover");
    };

    window.addEventListener("pointermove", handleScrollbarPointerMove, { passive: true });
    window.addEventListener("pointerleave", clearScrollbarHover);
    window.addEventListener("blur", clearScrollbarHover);

    const cleanupScrollbarHover = () => {
      window.removeEventListener("pointermove", handleScrollbarPointerMove);
      window.removeEventListener("pointerleave", clearScrollbarHover);
      window.removeEventListener("blur", clearScrollbarHover);
      clearScrollbarHover();
    };
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return cleanupScrollbarHover;

    let revealObserver;
    if (typeof window.IntersectionObserver === "function") {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("publicIsVisible");
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: 0.14, rootMargin: "0px 0px -36px 0px" });

      home.classList.add("publicMotionReady");
      home.querySelectorAll("[data-scroll-reveal]").forEach((element) => {
        revealObserver.observe(element);
      });
    }

    let animationFrame = null;
    const updateParallax = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        const scrollDistance = Math.min(window.scrollY, 1200);
        const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
        const scrollProgress =
          scrollRange > 0 ? Math.min(Math.max(window.scrollY / scrollRange, 0), 1) : 0;
        home.style.setProperty(
          "--public-scroll-progress",
          `${(scrollProgress * 100).toFixed(2)}%`,
        );
        const trackInset = Math.min(Math.max(window.innerWidth * 0.08, 64), 112);
        const carPosition =
          trackInset + scrollProgress * Math.max(window.innerWidth - trackInset * 2, 0);
        home.style.setProperty("--public-scroll-car-left", `${carPosition.toFixed(2)}px`);
        home.style.setProperty(
          "--public-parallax-slow",
          `${Math.round(scrollDistance * -0.06)}px`,
        );
        home.style.setProperty(
          "--public-parallax-fast",
          `${Math.round(scrollDistance * -0.12)}px`,
        );
      });
    };

    window.addEventListener("scroll", updateParallax, { passive: true });
    window.addEventListener("resize", updateParallax);
    updateParallax();

    return () => {
      cleanupScrollbarHover();
      revealObserver?.disconnect();
      window.removeEventListener("scroll", updateParallax);
      window.removeEventListener("resize", updateParallax);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      home.classList.remove("publicMotionReady");
      home.style.removeProperty("--public-scroll-progress");
      home.style.removeProperty("--public-scroll-car-left");
      home.style.removeProperty("--public-parallax-slow");
      home.style.removeProperty("--public-parallax-fast");
    };
  }, []);

  return (
    <main className="publicHome" ref={homeRef}>
      <div className="publicScrollJourney" aria-hidden="true">
        <span className="publicScrollTrack" />
        <span className="publicScrollVehicle">
          <svg
            className="publicCarIllustration"
            viewBox="0 0 64 32"
            role="presentation"
          >
            <defs>
              <linearGradient id="publicCarBody" x1="10" y1="10" x2="53" y2="27">
                <stop stopColor="#9b91ff" />
                <stop offset="1" stopColor="#43d9c2" />
              </linearGradient>
              <linearGradient id="publicCarWindows" x1="20" y1="12" x2="43" y2="19">
                <stop stopColor="#21365a" />
                <stop offset="1" stopColor="#12253d" />
              </linearGradient>
            </defs>
            <path
              d="M7.5 18.5h5.7l3.7-6.3a4.5 4.5 0 0 1 3.9-2.2H35a5.4 5.4 0 0 1 4.2 2l5.5 6.5h6.1a3.2 3.2 0 0 1 3.2 3.2v2.1a2.1 2.1 0 0 1-2.1 2.1h-2.1a5.1 5.1 0 0 0-10.2 0H26.2a5.1 5.1 0 0 0-10.2 0h-4.1a2.1 2.1 0 0 1-2.1-2.1v-3.2a2.1 2.1 0 0 1 2.1-2.1Z"
              fill="url(#publicCarBody)"
              stroke="#b4fff0"
              strokeLinejoin="round"
              strokeWidth="1.1"
            />
            <path
              d="m18 18.4 3.3-5.7a1.8 1.8 0 0 1 1.6-.9h8.1v6.6Zm14.4-6.6h2.8c1 0 1.9.4 2.5 1.2l4.7 5.4H32.4Z"
              fill="url(#publicCarWindows)"
              stroke="#a3f8e9"
              strokeLinejoin="round"
              strokeWidth=".8"
            />
            <circle cx="21.1" cy="25.2" r="4.2" fill="#091321" stroke="#78efda" strokeWidth="1.3" />
            <circle cx="44.6" cy="25.2" r="4.2" fill="#091321" stroke="#78efda" strokeWidth="1.3" />
            <circle cx="21.1" cy="25.2" r="1.5" fill="#a69aff" />
            <circle cx="44.6" cy="25.2" r="1.5" fill="#a69aff" />
            <path d="M9.7 19.5h2.1v2.4H9.7z" fill="#ff9d9d" />
            <path d="M52.4 19.5h1.7v2.4h-1.7z" fill="#fff0b0" />
          </svg>
        </span>
      </div>
      <header className="publicNav">
        <Link className="publicBrand" to="/" aria-label="Customer Sphere home">
          <span className="publicBrandMark" aria-hidden="true">
            <Sparkles size={19} />
          </span>
          <span>
            <strong>Customer Sphere</strong>
            <small>Customer intelligence</small>
          </span>
        </Link>
        <nav className="publicNavLinks" aria-label="Main navigation">
          <a href="#platform" onClick={scrollToSection}>Platform</a>
          <a href="#explore" onClick={scrollToSection}>Explore</a>
          <a href="#journey" onClick={scrollToSection}>How it works</a>
        </nav>
        <Link className="publicSignIn" to={primaryHref}>
          {primaryLabel} <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </header>

      <section className="publicHero" aria-labelledby="public-hero-title">
        <div className="publicHeroCopy" data-scroll-reveal>
          <div className="publicTrustPill">
            <span aria-hidden="true" />
            A clearer view of every customer
          </div>
          <h1 id="public-hero-title">
            Know customers.
            <span>Grow with clarity.</span>
          </h1>
          <p className="publicHeroLead">
            Understand what your customers need, what they value, and where to
            go next—with your business data, all in one place.
          </p>
          <div className="publicHeroActions">
            <Link className="publicPrimaryCta" to={primaryHref}>
              {isAuthenticated ? "Go to workspace" : "Sign in to your workspace"}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a className="publicSecondaryCta" href="#platform" onClick={scrollToSection}>
              Discover the platform
              <ArrowDown size={16} aria-hidden="true" />
            </a>
          </div>
          <div className="publicAssurance">
            <span><ShieldCheck size={16} aria-hidden="true" /> Your workspace stays private</span>
            <span><Check size={16} aria-hidden="true" /> Built for confident decisions</span>
          </div>
        </div>

        <div className="publicHeroOrbits" aria-hidden="true">
          <span className="publicHeroOrb publicHeroOrbOne" />
          <span className="publicHeroOrb publicHeroOrbTwo" />
        </div>
        <div className="publicHeroVisual" aria-label="Customer Sphere analytics preview" data-scroll-reveal>
          <img
            className="publicHeroPhoto"
            src="https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1400&q=85"
            alt="A team working together around a table"
            fetchpriority="high"
          />
          <div className="publicPhotoOverlay" />
          <div className="publicPhotoCaption">
            <span className="publicCaptionIcon"><Compass size={17} /></span>
            <span><strong>Find your next move</strong><small>Insight that brings you closer to customers</small></span>
          </div>
          <div className="publicInsightCard">
            <div className="publicInsightHeading">
              <span className="publicInsightIcon"><BarChart3 size={16} /></span>
              <span><strong>Customer overview</strong><small>Your business at a glance</small></span>
              <span className="publicLiveDot" aria-label="Current overview" />
            </div>
            <div className="publicMetric">
              <span>Customer relationships</span>
              <strong>Know what matters</strong>
            </div>
            <div className="publicChart" aria-hidden="true">
              <span style={{ height: "36%" }} />
              <span style={{ height: "54%" }} />
              <span style={{ height: "45%" }} />
              <span style={{ height: "69%" }} />
              <span style={{ height: "57%" }} />
              <span style={{ height: "83%" }} />
              <span style={{ height: "72%" }} />
              <span style={{ height: "100%" }} />
              <span style={{ height: "86%" }} />
            </div>
            <div className="publicChartLabels"><span>Understand</span><span>Take action</span></div>
            <div className="publicInsightFooter">
              <Sparkles size={14} aria-hidden="true" />
              <span>Insights made easier with Nova</span>
              <ArrowRight size={14} aria-hidden="true" />
            </div>
          </div>
        </div>
        <div className="publicHeroFootnote" data-scroll-reveal>
          <CircleHelp size={14} aria-hidden="true" />
          Customer intelligence designed to feel simple.
        </div>
      </section>

      <section className="publicPlatform" id="platform" aria-labelledby="platform-title">
        <div className="publicSectionIntro" data-scroll-reveal>
          <p className="publicEyebrow">YOUR CUSTOMER DATA, IN CONTEXT</p>
          <h2 id="platform-title">From information to understanding.</h2>
          <p>
            Spend less time searching across reports and more time seeing the
            story your customer data is telling.
          </p>
        </div>
        <div className="publicFeatureGrid">
          {highlights.map(({ icon: Icon, title, description, path }, index) => (
            <Link
              className="publicFeatureCardLink"
              key={title}
              to={isAuthenticated ? path : "/login"}
              data-scroll-reveal
            >
              <article className="publicFeatureCard">
                <span className={`publicFeatureIcon publicFeatureIcon${index + 1}`}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
                <span className="publicFeatureArrow" aria-hidden="true">
                  <ArrowRight size={17} />
                </span>
              </article>
            </Link>
          ))}
        </div>
      </section>

      <section className="publicExplore" id="explore" aria-labelledby="explore-title">
        <div className="publicExploreIntro" data-scroll-reveal>
          <div>
            <p className="publicEyebrow">ONE WORKSPACE, MORE PERSPECTIVE</p>
            <h2 id="explore-title">Get closer to the details that matter.</h2>
          </div>
          <p>
            Move between customer context and business-wide patterns without
            losing sight of the people behind the data.
          </p>
        </div>

        <div className="publicProductGrid">
          {productAreas.map(({ icon: Icon, title, description, label, tone, path }) => (
            <article
              className={`publicProductCard publicProductCard-${tone}`}
              key={title}
              data-scroll-reveal
            >
              <div className="publicProductTop">
                <span className="publicProductIcon"><Icon size={19} aria-hidden="true" /></span>
                <span className="publicProductLabel">{label}</span>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
              <Link className="publicProductLink" to={isAuthenticated ? path : "/login"}>
                Explore in your workspace <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>

        <div className="publicInsightShowcase">
          <div className="publicShowcaseCopy" data-scroll-reveal>
            <p className="publicEyebrow">A MORE CONNECTED VIEW</p>
            <h3>From one customer story to the bigger picture.</h3>
            <p>
              Start with a customer profile, explore their purchase history,
              then step back to see broader patterns in your business.
            </p>
            <ul>
              <li><Check size={15} aria-hidden="true" /> Customer and order context together</li>
              <li><Check size={15} aria-hidden="true" /> Product, review, and revenue views</li>
              <li><Check size={15} aria-hidden="true" /> Access based on your workspace permissions</li>
            </ul>
            <Link className="publicTextLink" to={primaryHref}>
              {isAuthenticated ? "Go to workspace" : "Sign in to explore"}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="publicShowcaseVisual" data-scroll-reveal>
            <img
              src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=85"
              alt="Colleagues reviewing ideas together"
              loading="lazy"
            />
            <div className="publicShowcaseShade" />
            <div className="publicShowcaseBadge">
              <span className="publicShowcaseBadgeIcon"><Activity size={17} aria-hidden="true" /></span>
              <span><strong>Every view adds context</strong><small>Explore customers, activity, and trends</small></span>
            </div>
            <div className="publicShowcaseNote">
              <Search size={14} aria-hidden="true" />
              <span>Start with a question. Follow the insight.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="publicJourney" id="journey" aria-labelledby="journey-title">
        <div className="publicSectionIntro" data-scroll-reveal>
          <p className="publicEyebrow">A NATURAL WAY TO WORK</p>
          <h2 id="journey-title">Find your way from question to action.</h2>
          <p>
            A straightforward flow helps you make the most of the customer and
            business information in your workspace.
          </p>
        </div>
        <div className="publicJourneySteps">
          <article className="publicJourneyStep" data-scroll-reveal>
            <span className="publicStepNumber">01</span>
            <span className="publicStepIcon"><Search size={19} aria-hidden="true" /></span>
            <h3>Start with a question</h3>
            <p>Choose a customer, a product, or a business trend you want to understand.</p>
          </article>
          <article className="publicJourneyStep" data-scroll-reveal>
            <span className="publicStepNumber">02</span>
            <span className="publicStepIcon"><MapPinned size={19} aria-hidden="true" /></span>
            <h3>Explore the context</h3>
            <p>Move through profiles, order history, analytics, and the details around them.</p>
          </article>
          <article className="publicJourneyStep" data-scroll-reveal>
            <span className="publicStepNumber">03</span>
            <span className="publicStepIcon"><Sparkles size={19} aria-hidden="true" /></span>
            <h3>Decide what comes next</h3>
            <p>Use clear, connected information to guide your next conversation or decision.</p>
          </article>
        </div>
      </section>

      <section className="publicClarity" id="built-for-clarity" data-scroll-reveal>
        <div>
          <p className="publicEyebrow">A BETTER WAY TO SEE YOUR BUSINESS</p>
          <h2>Make the next decision with more confidence.</h2>
          <p>
            Your customer relationships are more than rows in a table. Customer
            Sphere helps connect the details to the bigger picture.
          </p>
        </div>
        <Link className="publicPrimaryCta" to={primaryHref}>
          {isAuthenticated ? "Go to workspace" : "Sign in to your workspace"}
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>

      <footer className="publicFooter">
        <Link className="publicBrand" to="/" aria-label="Customer Sphere home">
          <span className="publicBrandMark" aria-hidden="true"><Sparkles size={17} /></span>
          <strong>Customer Sphere</strong>
        </Link>
        <span>Customer intelligence, made clear.</span>
        <Link to={primaryHref}>{primaryLabel} <ChevronRight size={15} aria-hidden="true" /></Link>
      </footer>
    </main>
  );
}
