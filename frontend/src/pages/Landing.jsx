import React, { useEffect } from "react";
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

const highlights = [
  {
    icon: BarChart3,
    title: "See the whole picture",
    description:
      "Bring revenue, orders, reviews, and customer behavior together in one clear view.",
  },
  {
    icon: UsersRound,
    title: "Know your customers",
    description:
      "Explore customer profiles, purchase histories, and the patterns behind loyalty.",
  },
  {
    icon: Sparkles,
    title: "Ask better questions",
    description:
      "Use Nova to turn plain-language questions into useful, data-backed answers.",
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
  },
  {
    icon: TrendingUp,
    title: "Business analytics",
    description:
      "Explore revenue, order activity, product trends, and customer patterns through focused views.",
    label: "ANALYTICS",
    tone: "teal",
  },
  {
    icon: MessageCircle,
    title: "Nova, your AI assistant",
    description:
      "Ask questions in everyday language and get answers grounded in the business data available to your account.",
    label: "ASK NOVA",
    tone: "amber",
  },
  {
    icon: PackageOpen,
    title: "Products and orders",
    description:
      "Follow the connection between what customers buy, how orders progress, and what they say afterward.",
    label: "PURCHASE JOURNEY",
    tone: "blue",
  },
];

export default function Landing() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("publicSmoothScroll");
    return () => root.classList.remove("publicSmoothScroll");
  }, []);

  return (
    <main className="publicHome">
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
          <a href="#platform">Platform</a>
          <a href="#explore">Explore</a>
          <a href="#journey">How it works</a>
        </nav>
        <Link className="publicSignIn" to="/login">
          Sign in <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </header>

      <section className="publicHero" aria-labelledby="public-hero-title">
        <div className="publicHeroCopy">
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
            <Link className="publicPrimaryCta" to="/login">
              Sign in to your workspace
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a className="publicSecondaryCta" href="#platform">
              Discover the platform
              <ArrowDown size={16} aria-hidden="true" />
            </a>
          </div>
          <div className="publicAssurance">
            <span><ShieldCheck size={16} aria-hidden="true" /> Your workspace stays private</span>
            <span><Check size={16} aria-hidden="true" /> Built for confident decisions</span>
          </div>
        </div>

        <div className="publicHeroVisual" aria-label="Customer Sphere analytics preview">
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
        <div className="publicHeroFootnote">
          <CircleHelp size={14} aria-hidden="true" />
          Customer intelligence designed to feel simple.
        </div>
      </section>

      <section className="publicPlatform" id="platform" aria-labelledby="platform-title">
        <div className="publicSectionIntro">
          <p className="publicEyebrow">YOUR CUSTOMER DATA, IN CONTEXT</p>
          <h2 id="platform-title">From information to understanding.</h2>
          <p>
            Spend less time searching across reports and more time seeing the
            story your customer data is telling.
          </p>
        </div>
        <div className="publicFeatureGrid">
          {highlights.map(({ icon: Icon, title, description }, index) => (
            <article className="publicFeatureCard" key={title}>
              <span className={`publicFeatureIcon publicFeatureIcon${index + 1}`}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="publicFeatureArrow" aria-hidden="true">
                <ArrowRight size={17} />
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="publicExplore" id="explore" aria-labelledby="explore-title">
        <div className="publicExploreIntro">
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
          {productAreas.map(({ icon: Icon, title, description, label, tone }) => (
            <article className={`publicProductCard publicProductCard-${tone}`} key={title}>
              <div className="publicProductTop">
                <span className="publicProductIcon"><Icon size={19} aria-hidden="true" /></span>
                <span className="publicProductLabel">{label}</span>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
              <Link className="publicProductLink" to="/login">
                Explore in your workspace <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>

        <div className="publicInsightShowcase">
          <div className="publicShowcaseCopy">
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
            <Link className="publicTextLink" to="/login">
              Sign in to explore <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="publicShowcaseVisual">
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
        <div className="publicSectionIntro">
          <p className="publicEyebrow">A NATURAL WAY TO WORK</p>
          <h2 id="journey-title">Find your way from question to action.</h2>
          <p>
            A straightforward flow helps you make the most of the customer and
            business information in your workspace.
          </p>
        </div>
        <div className="publicJourneySteps">
          <article className="publicJourneyStep">
            <span className="publicStepNumber">01</span>
            <span className="publicStepIcon"><Search size={19} aria-hidden="true" /></span>
            <h3>Start with a question</h3>
            <p>Choose a customer, a product, or a business trend you want to understand.</p>
          </article>
          <article className="publicJourneyStep">
            <span className="publicStepNumber">02</span>
            <span className="publicStepIcon"><MapPinned size={19} aria-hidden="true" /></span>
            <h3>Explore the context</h3>
            <p>Move through profiles, order history, analytics, and the details around them.</p>
          </article>
          <article className="publicJourneyStep">
            <span className="publicStepNumber">03</span>
            <span className="publicStepIcon"><Sparkles size={19} aria-hidden="true" /></span>
            <h3>Decide what comes next</h3>
            <p>Use clear, connected information to guide your next conversation or decision.</p>
          </article>
        </div>
      </section>

      <section className="publicClarity" id="built-for-clarity">
        <div>
          <p className="publicEyebrow">A BETTER WAY TO SEE YOUR BUSINESS</p>
          <h2>Make the next decision with more confidence.</h2>
          <p>
            Your customer relationships are more than rows in a table. Customer
            Sphere helps connect the details to the bigger picture.
          </p>
        </div>
        <Link className="publicPrimaryCta" to="/login">
          Enter your workspace <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>

      <footer className="publicFooter">
        <Link className="publicBrand" to="/" aria-label="Customer Sphere home">
          <span className="publicBrandMark" aria-hidden="true"><Sparkles size={17} /></span>
          <strong>Customer Sphere</strong>
        </Link>
        <span>Customer intelligence, made clear.</span>
        <Link to="/login">Sign in <ChevronRight size={15} aria-hidden="true" /></Link>
      </footer>
    </main>
  );
}
