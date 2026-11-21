import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowLeft, ArrowRight, BadgeCheck, BookOpen, Check, CheckCircle2, CircleHelp,
  Clock3, Compass, CreditCard, ExternalLink, GraduationCap, LayoutDashboard, Leaf, LockKeyhole, LogIn,
  LogOut, Menu, MessageCircle, Search, ShieldCheck, SlidersHorizontal, Sparkles, Target, X
} from 'lucide-react';

type User = { id:string; name:string; email:string; role:'learner'|'admin' };
type Lesson = { id:string; domainId:number; title:string; minutes:number; preview?:boolean; locked?:boolean; completed?:boolean };
type Domain = { id:number; title:string; weight:number; color:string; summary:string; lessons:Lesson[] };
type Question = { id:string; prompt:string; options:string[] };
type Result = { score:number; total:number; percent:number; detail:{questionId:string;selected:number;answer:number;correct:boolean;explanation:string}[]; note:string };
type CourseLesson = Lesson & { body:string[]; exercise:string };
type Billing = { configured:boolean; state:string; message:string; portalAvailable:boolean };
type Progress = { lessons:{ lesson_id:string }[]; attempts:{domain_id:number;score:number;total:number;created_at:string}[] };
type Session = { user:User|null };
class ApiError extends Error {
  constructor(message:string, public status:number) { super(message); }
}
const messageOf = (error:unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

async function api<T>(path:string, options:RequestInit={}):Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type','application/json');
  const response = await fetch(`/api${path}`,{...options,headers,credentials:'include'});
  const data:unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Request failed.';
    throw new ApiError(message,response.status);
  }
  return data as T;
}

const domainIcons = [Target,ShieldCheck,Sparkles,Compass,BookOpen,Leaf,CheckCircle2];

export default function App() {
  const [user,setUser]=useState<User|null>(null);
  const [domains,setDomains]=useState<Domain[]>([]);
  const [page,setPage]=useState<'home'|'lesson'|'quiz'|'tutor'|'pricing'|'admin'>('home');
  const [lesson,setLesson]=useState<CourseLesson|null>(null);
  const [quizDomain,setQuizDomain]=useState<number|null>(null);
  const [quiz,setQuiz]=useState<Question[]>([]);
  const [answers,setAnswers]=useState<Record<string,number>>({});
  const [result,setResult]=useState<Result|null>(null);
  const [billing,setBilling]=useState<Billing|null>(null);
  const [authOpen,setAuthOpen]=useState(false);
  const [authMode,setAuthMode]=useState<'register'|'login'>('register');
  const [authBusy,setAuthBusy]=useState(false);
  const [authError,setAuthError]=useState('');
  const [toast,setToast]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [mobileMenu,setMobileMenu]=useState(false);
  const [adminItems,setAdminItems]=useState<CourseLesson[]>([]);
  const [adminLessonId,setAdminLessonId]=useState('');
  const [bootstrapKey,setBootstrapKey]=useState('');
  const [billingNotice,setBillingNotice]=useState('');
  const [tutorQuestion,setTutorQuestion]=useState('');
  const [tutorAnswer,setTutorAnswer]=useState('');
  const [tutorRemaining,setTutorRemaining]=useState<number|null>(null);
  const [search,setSearch]=useState('');
  const [freeOnly,setFreeOnly]=useState(false);
  const [catalogLoading,setCatalogLoading]=useState(true);

  const refresh=useCallback(async()=>{
    try {
      const [session,catalog,bill]=await Promise.all([api<Session>('/session'),api<{domains:Domain[]}>('/catalog'),api<Billing>('/billing')]);
      setUser(session.user); setDomains(catalog.domains); setBilling(bill);
      if(session.user) {
        const progress=await api<Progress>('/progress');
        const done=new Set(progress.lessons.map(x=>x.lesson_id));
        setDomains(current=>current.map(d=>({...d,lessons:d.lessons.map(l=>({...l,completed:done.has(l.id)}))})));
      }
    } catch(e:unknown) { setError(messageOf(e)); }
    finally { setCatalogLoading(false); }
  },[]);
  useEffect(()=>{refresh();},[refresh]);
  useEffect(()=>{
    const params=new URLSearchParams(location.search);
    if(params.get('billing')==='return') setBillingNotice('Checkout returned. Access changes only after the verified payment-provider event is received.');
    if(params.get('billing')==='cancelled') setBillingNotice('Checkout was cancelled. Your free preview is still available.');
    if(params.has('billing')) { history.replaceState({},'',location.pathname); }
  },[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3600);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{
    if(!authOpen)return;
    setAuthError('');
    const previous=document.activeElement;
    const modal=document.querySelector<HTMLElement>('.auth-modal');
    const focusable=()=>Array.from(modal?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')||[]);
    focusable()[0]?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setAuthOpen(false);return;}
      if(event.key!=='Tab')return;
      const items=focusable();const first=items[0];const last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('keydown',onKey);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
  },[authOpen]);
  const completed=useMemo(()=>domains.flatMap(d=>d.lessons).filter(l=>l.completed).length,[domains]);
  const totalLessons=domains.reduce((sum,d)=>sum+d.lessons.length,0);
  const progressPercent=totalLessons?Math.round(completed*100/totalLessons):0;
  const activeDomain=lesson?domains.find(d=>d.id===lesson.domainId):null;
  const query=search.trim().toLowerCase();
  const visibleDomains=domains.filter(d=>
    (!freeOnly||d.lessons.some(l=>l.preview))&&
    (!query||[d.title,d.summary,...d.lessons.map(l=>l.title)].some(text=>text.toLowerCase().includes(query)))
  );
  const featuredLessons=visibleDomains.flatMap(domain=>{
    const item=freeOnly?domain.lessons.find(l=>l.preview):
      domain.lessons.find(l=>!l.completed&&(!query||l.title.toLowerCase().includes(query)))||
      domain.lessons.find(l=>!l.completed)||domain.lessons[0];
    return item?[{domain,lesson:item}]:[];
  }).slice(0,3);
  const nextLesson=domains.flatMap(d=>d.lessons).find(l=>!l.locked&&!l.completed)||
    domains.flatMap(d=>d.lessons).find(l=>!l.locked);
  const studyFocus=[...domains].sort((a,b)=>b.weight-a.weight).slice(0,5);
  const initials=user?user.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase():'FA';

  const go=(next:typeof page)=>{setPage(next);setError('');setMobileMenu(false);window.scrollTo({top:0,behavior:'smooth'});};
  const openCourseMap=()=>{
    go('home');
    requestAnimationFrame(()=>document.getElementById('course-map')?.scrollIntoView({behavior:'smooth'}));
  };
  async function loadLesson(id:string) {
    setBusy(true);setError('');
    try {const data=await api<{lesson:CourseLesson}>(`/lessons/${id}`);setLesson(data.lesson);go('lesson');}
    catch(e:unknown){if(e instanceof ApiError && e.status===402)go('pricing');else setError(messageOf(e));}
    finally{setBusy(false);}
  }
  async function loadQuiz(domainId:number) {
    setBusy(true);setError('');
    try {const data=await api<{questions:Question[]}>(`/quiz/${domainId}`);setQuizDomain(domainId);setQuiz(data.questions);setAnswers({});setResult(null);go('quiz');}
    catch(e:unknown){if(e instanceof ApiError && e.status===402)go('pricing');else setError(messageOf(e));}
    finally{setBusy(false);}
  }
  async function authenticate(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setAuthBusy(true);setAuthError('');
    const form=new FormData(event.currentTarget);
    const payload=Object.fromEntries(form.entries());
    try {
      const data=await api<{user:User}>(`/auth/${authMode}`,{method:'POST',body:JSON.stringify(payload)});
      setUser(data.user);setAuthOpen(false);setToast(authMode==='register'?'Welcome to your learning space.':'You’re signed in.');await refresh();
    } catch(e:unknown){setAuthError(messageOf(e));} finally{setAuthBusy(false);}
  }
  async function logout() {
    try {await api('/auth/logout',{method:'POST'});setUser(null);setLesson(null);setQuiz([]);setResult(null);setTutorAnswer('');setAdminItems([]);go('home');setToast('Signed out.');await refresh();}
    catch(e:unknown){setError(messageOf(e));}
  }
  async function finishLesson() {
    if(!user){setAuthOpen(true);return;}
    try {await api('/progress',{method:'POST',body:JSON.stringify({lessonId:lesson?.id})});setToast('Lesson saved to your progress.');await refresh();}
    catch(e:unknown){setError(messageOf(e));}
  }
  async function submitQuiz() {
    if(!user){setAuthOpen(true);return;}
    if(quiz.length!==Object.keys(answers).length){setError('Answer each question before submitting.');return;}
    setBusy(true);setError('');
    try {const data=await api<Result>('/quiz/submit',{method:'POST',body:JSON.stringify({domainId:quizDomain,answers:quiz.map(q=>({questionId:q.id,choice:answers[q.id]}))})});setResult(data);setToast('Your practice results are ready.');await refresh();}
    catch(e:unknown){setError(messageOf(e));}
    finally{setBusy(false);}
  }
  async function startCheckout() {
    if(!user){setAuthOpen(true);return;}
    setBusy(true);setError('');
    try {const data=await api<{url:string}>('/billing/checkout',{method:'POST',body:'{}'});location.assign(data.url);}
    catch(e:unknown){setError(messageOf(e));}
    finally{setBusy(false);}
  }
  async function openPortal() {
    setBusy(true);
    try {const data=await api<{url:string}>('/billing/portal',{method:'POST',body:'{}'});location.assign(data.url);}
    catch(e:unknown){setError(messageOf(e));}
    finally{setBusy(false);}
  }
  async function askTutor(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');setTutorAnswer('');
    try {const data=await api<{answer:string;remaining:number}>('/tutor',{method:'POST',body:JSON.stringify({message:tutorQuestion})});setTutorAnswer(data.answer);setTutorRemaining(data.remaining);}
    catch(e:unknown){setError(messageOf(e));}
    finally{setBusy(false);}
  }
  async function openAdmin() {
    if(!user){setAuthOpen(true);return;}
    if(user.role!=='admin'){setAdminItems([]);go('admin');return;}
    try {const data=await api<{lessons:CourseLesson[]}>('/admin/lessons');setAdminItems(data.lessons);setAdminLessonId(data.lessons[0]?.id||'');go('admin');}
    catch(e:unknown){setError(messageOf(e));}
  }
  async function bootstrapAdmin(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    try {const data=await api<{user:User}>('/admin/bootstrap',{method:'POST',body:JSON.stringify({key:bootstrapKey})});setUser(data.user);setBootstrapKey('');const content=await api<{lessons:CourseLesson[]}>('/admin/lessons');setAdminItems(content.lessons);setAdminLessonId(content.lessons[0]?.id||'');setToast('Administrator access enabled.');go('admin');}
    catch(e:unknown){setError(messageOf(e));}
    finally{setBusy(false);}
  }
  async function saveLesson(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const item=adminItems.find(x=>x.id===adminLessonId);if(!item)return;
    const body=String(form.get('body')||'').split('\n\n').map(x=>x.trim()).filter(Boolean);
    setBusy(true);setError('');
    try {const data=await api<{lesson:CourseLesson}>(`/admin/lessons/${item.id}`,{method:'PUT',body:JSON.stringify({title:form.get('title'),body,exercise:form.get('exercise')})});setAdminItems(items=>items.map(x=>x.id===item.id?data.lesson:x));setToast('Lesson saved.');await refresh();}
    catch(e:unknown){setError(messageOf(e));}
    finally{setBusy(false);}
  }

  return <div className="app-shell">
    {mobileMenu&&<button className="sidebar-scrim" aria-label="Close navigation" onClick={()=>setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu?'sidebar-open':''}`} id="sidebar-navigation">
      <div className="sidebar-brand">
      <button className="brand" onClick={()=>go('home')} aria-label="Fahan Academy home">
        <span className="brand-mark"><Sparkles size={20}/></span><span className="brand-copy">FAHAN<span>ACADEMY</span></span>
      </button>
      <button className="mobile-toggle icon-button" onClick={()=>setMobileMenu(false)} aria-label="Close menu"><X size={19}/></button>
      </div>
      <div className="nav-caption">OVERVIEW</div>
      <nav className="side-nav" aria-label="Main navigation">
        <button className={page==='home'?'nav-active':''} aria-current={page==='home'?'page':undefined} onClick={()=>go('home')}><LayoutDashboard size={18}/>Dashboard</button>
        <button className={page==='lesson'?'nav-active':''} aria-current={page==='lesson'?'page':undefined} onClick={openCourseMap}><BookOpen size={18}/>My lessons</button>
        <button className={page==='quiz'?'nav-active':''} aria-current={page==='quiz'?'page':undefined} onClick={()=>loadQuiz(1)}><Target size={18}/>Practice quizzes</button>
        <button className={page==='tutor'?'nav-active':''} aria-current={page==='tutor'?'page':undefined} onClick={()=>go('tutor')}><MessageCircle size={18}/>AI tutor</button>
        <button className={page==='pricing'?'nav-active':''} aria-current={page==='pricing'?'page':undefined} onClick={()=>go('pricing')}><CreditCard size={18}/>Membership</button>
        {user&&<button className={page==='admin'?'nav-active':''} onClick={openAdmin}><ShieldCheck size={18}/>{user.role==='admin'?'Content studio':'Admin setup'}</button>}
      </nav>
      <div className="nav-caption">YOUR WORKSPACE</div>
      <div className="workspace-note"><span className="workspace-dot"/><div><strong>Foundations pathway</strong><small>7 domains · Your own pace</small></div></div>
      <div className="sidebar-bottom">
        <div className="sidebar-promo"><span className="promo-icon"><GraduationCap size={24}/></span><strong>A little learning.<br/>A lot of possibility.</strong><p>Make room for your next big idea.</p><button onClick={()=>go('pricing')}>Explore membership <ArrowRight size={14}/></button></div>
        {user?<button className="sidebar-account logout-link" onClick={logout}><LogOut size={17}/>Log out</button>:
        <button className="sidebar-account" onClick={()=>{setAuthMode('register');setAuthOpen(true);setMobileMenu(false);}}><LogIn size={17}/>Create an account</button>}
        <span className="sidebar-footnote">Learn something that stays with you.</span>
      </div>
    </aside>

    <div className="workspace">
    <div className="main-column">
    <header className="topbar">
      <button className="mobile-toggle icon-button" onClick={()=>setMobileMenu(!mobileMenu)} aria-label="Toggle navigation" aria-expanded={mobileMenu} aria-controls="sidebar-navigation"><Menu size={21}/></button>
      <span className="mobile-brand">fahan<span> academy</span></span>
      <form className="course-search" role="search" onSubmit={event=>{event.preventDefault();go('home');}}>
        <button type="submit" aria-label="Search courses"><Search size={18}/></button>
        <input aria-label="Search lessons and topics" type="search" placeholder="Search your next lesson..." value={search} onChange={event=>setSearch(event.target.value)}/>
      </form>
      <button className={`filter-button icon-button ${freeOnly?'filter-active':''}`} aria-label="Free preview filter" aria-pressed={freeOnly} title={freeOnly?'Show all lessons':'Show free previews only'} onClick={()=>{setFreeOnly(!freeOnly);go('home');}}><SlidersHorizontal size={20}/></button>
      <div className="top-actions">
        {user?<><span className="avatar">{initials}</span><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={18}/></button></>
        :<button className="button button-outline button-small" onClick={()=>{setAuthMode('login');setAuthOpen(true);}}><LogIn size={15}/> Sign in</button>}
      </div>
    </header>

    {error&&<div className="notice notice-error" role="alert"><CircleHelp size={18}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    {billingNotice&&<div className="notice notice-info"><CreditCard size={17}/><span>{billingNotice}</span><button onClick={()=>setBillingNotice('')} aria-label="Dismiss message"><X size={16}/></button></div>}

    <div className="page-wrap">
      {page==='home'&&<main className="dashboard">
        <section className="course-banner">
          <div className="banner-copy">
            <div className="banner-label"><span/> YOUR NEXT CHAPTER STARTS HERE</div>
            <h1>Build your AI skills.<br/>Grow your confidence.</h1>
            <p>Independent preparation for<br/>Claude Certified Associate – Foundations.</p>
            <button className="banner-button" disabled={busy} onClick={()=>loadLesson(nextLesson?.id||'d1-l1')}>{user?'Continue learning':'Start learning'}<span><ArrowRight size={15}/></span></button>
          </div>
          <div className="banner-art" aria-hidden="true"><Sparkles className="banner-spark spark-one"/><Sparkles className="banner-spark spark-two"/><div className="banner-orbit"/><div className="banner-orbit orbit-small"/><GraduationCap className="banner-cap"/></div>
        </section>

        <section className="stats-row" aria-label="Learning overview">
          <div className="stat-card"><span className="stat-icon"><BookOpen size={19}/></span><div><strong>{catalogLoading?'—':`${completed} / ${totalLessons}`}</strong><span>Lessons complete</span></div><CheckCircle2 className="stat-decoration" size={16}/></div>
          <div className="stat-card"><span className="stat-icon icon-peach"><Compass size={19}/></span><div><strong>{catalogLoading?'—':String(domains.length).padStart(2,'0')}</strong><span>Learning domains</span></div><span className="stat-decoration">↗</span></div>
          <div className="stat-card"><span className="stat-icon icon-blue"><Target size={19}/></span><div><strong>{catalogLoading?'—':String(domains.length).padStart(2,'0')}</strong><span>Practice quizzes</span></div><CheckCircle2 className="stat-decoration" size={16}/></div>
        </section>

        <section className="featured-section" aria-labelledby="featured-heading">
          <div className="section-heading"><div><h2 id="featured-heading">{query?'Your search results':user?'Continue learning':'Find your next lesson'}</h2><p>{freeOnly?'Showing the free preview.':'Small steps today. Stronger skills tomorrow.'}</p></div><button className="text-button" onClick={openCourseMap}>View all <ArrowRight size={15}/></button></div>
          {catalogLoading?<p className="empty-state" role="status">Loading your learning path...</p>:featuredLessons.length===0?
          <div className="empty-state"><Search size={25}/><h3>No matching lessons</h3><p>Try a different topic or clear your filters.</p><button className="button button-outline" onClick={()=>{setSearch('');setFreeOnly(false);}}>Clear filters</button></div>:
          <div className="featured-grid">{featuredLessons.map(({domain,lesson:item},index)=>{
            const Icon=domainIcons[domain.id-1]||BookOpen;
            const done=domain.lessons.filter(l=>l.completed).length;
            return <article className="learning-card" key={domain.id}>
              <button className={`course-cover cover-${index%3}`} aria-label={`${item.locked?'View membership for':'Open lesson:'} ${item.title}`} disabled={busy} onClick={()=>item.locked?go('pricing'):loadLesson(item.id)}>
                <span className="cover-kicker">FAHAN / DOMAIN {String(domain.id).padStart(2,'0')}</span>
                <span className="cover-title">{domain.title}</span><Icon className="cover-symbol" strokeWidth={1.3}/>
                <span className="cover-open">{item.completed?<Check size={16}/>:item.locked?<LockKeyhole size={15}/>:<ArrowRight size={17}/>}</span>
                <span className="cover-pattern" aria-hidden="true"/>
              </button>
              <div className="learning-card-body"><span className={`course-tag tag-${index%3}`}>{item.preview?'FREE PREVIEW':item.completed?'COMPLETED':'FOUNDATIONS'}</span><h3><button onClick={()=>item.locked?go('pricing'):loadLesson(item.id)}>{item.title}</button></h3><p className="card-domain">{domain.title}</p>
                <div className="card-progress" role="progressbar" aria-label={`${domain.title} lessons complete`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={domain.lessons.length}><span style={{width:`${done/domain.lessons.length*100}%`}}/></div>
                <div className="card-meta"><span><Clock3 size={13}/>{item.minutes} min lesson</span><span>{done}/{domain.lessons.length} complete</span></div>
              </div>
            </article>;
          })}</div>}
        </section>

        <section id="course-map" className="course-section">
          <div className="section-heading"><div><h2>Your learning path</h2><p>Everything you need, one domain at a time.</p></div><span className="path-count">{visibleDomains.length} {visibleDomains.length===1?'domain':'domains'}</span></div>
          <div className="catalog-head" aria-hidden="true"><span>DOMAIN</span><span>YOUR LESSONS</span><span>PRACTICE</span></div>
          <div className="domain-list">{visibleDomains.map(d=>{
            const Icon=domainIcons[d.id-1]||BookOpen;const done=d.lessons.filter(l=>l.completed).length;
            return <article className="domain-card" key={d.id}>
              <div className="domain-info"><span className={`domain-icon domain-${d.color}`}><Icon size={20}/></span><div><h3>{d.title}</h3><span>{d.weight}% study focus · {done}/{d.lessons.length} complete</span></div></div>
              <div className="lesson-list">{d.lessons.filter(l=>!freeOnly||l.preview).map((l,i)=><button className={`lesson-row ${l.locked?'is-locked':''}`} key={l.id} disabled={busy} onClick={()=>l.locked?go('pricing'):loadLesson(l.id)}>
                <span className="lesson-index">{l.completed?<Check size={14}/>:l.locked?<LockKeyhole size={13}/>:`0${i+1}`}</span><span className="lesson-title">{l.title}</span><span className="lesson-min">{l.minutes}m</span><ArrowRight className="row-arrow" size={14}/>
              </button>)}</div>
              <button className="quiz-link" aria-label={`Practice quiz: ${d.title}`} disabled={busy} onClick={()=>loadQuiz(d.id)}>Practice quiz <ArrowRight size={13}/></button>
            </article>
          })}</div>
          <div className="course-disclaimer"><ShieldCheck size={17}/><span>Independent study resource. Topic weights are for study focus only—not an official score prediction or certification guarantee.</span></div>
        </section>
      </main>}

      {page==='lesson'&&lesson&&<main className="content-page">
        <button className="back-link" onClick={()=>go('home')}><ArrowLeft size={16}/> Course map</button>
        <div className="lesson-layout">
          <article className="lesson-reader">
            <div className="eyebrow">DOMAIN {String(lesson.domainId).padStart(2,'0')} · {activeDomain?.title}</div>
            <h1>{lesson.title}</h1><div className="lesson-meta"><span><Clock3 size={15}/>{lesson.minutes} min read</span><span><BookOpen size={15}/>Practical lesson</span></div>
            <div className="lesson-body">{lesson.body.map((p,i)=><p key={i}>{p}</p>)}</div>
            <div className="exercise-box"><div className="exercise-heading"><span><Target size={17}/></span><div><small>PUT IT INTO PRACTICE</small><h3>Your reflection</h3></div></div><p>{lesson.exercise}</p><div className="exercise-hint"><Sparkles size={15}/> Take a moment to jot down your thinking somewhere private.</div></div>
            <div className="lesson-actions"><button className="button button-dark" onClick={finishLesson}><CheckCircle2 size={17}/> {lesson.completed?'Update progress':'Mark lesson complete'}</button><button className="button button-outline" onClick={()=>loadQuiz(lesson.domainId)}>Try the practice quiz <ArrowRight size={16}/></button></div>
            <p className="source-note"><ShieldCheck size={15}/> The exam facts that informed this study outline come from a user-supplied guide; they have not been independently verified. Confirm current details with the official provider.</p>
          </article>
          <aside className="lesson-aside"><div className="aside-card"><div className="aside-label">IN THIS DOMAIN</div><h3>{activeDomain?.title}</h3><div className="weight-meter"><span style={{width:`${activeDomain?.weight}%`}}/></div><div className="weight-label"><span>Study emphasis</span><strong>{activeDomain?.weight}%</strong></div><p>Weights help you prioritize your study time. They are approximate and do not convert to a score.</p><div className="aside-divider"/><span className="aside-label">YOUR NEXT STEP</span><button className="next-card" onClick={()=>loadQuiz(lesson.domainId)}><span className="next-icon"><CircleHelp size={17}/></span><span><b>Check your understanding</b><small>Try original practice questions</small></span><ArrowRight size={15}/></button></div><div className="aside-note"><Leaf size={18}/><p>Pause, reflect, and connect the idea to a workflow you already know.</p></div></aside>
        </div>
      </main>}

      {page==='quiz'&&<main className="content-page quiz-page">
        <button className="back-link" onClick={()=>go('home')}><ArrowLeft size={16}/> Back to course</button>
        <div className="quiz-heading"><span className="quiz-badge"><CircleHelp size={19}/></span><div><div className="eyebrow">DOMAIN {String(quizDomain||1).padStart(2,'0')} · KNOWLEDGE CHECK</div><h1>{domains.find(d=>d.id===quizDomain)?.title}</h1><p>Original practice questions · {quiz.length} questions</p></div></div>
        {!result?<div className="question-stack">{quiz.map((q,i)=><section className="question-card" key={q.id}><div className="question-number">QUESTION {String(i+1).padStart(2,'0')} <span>OF {String(quiz.length).padStart(2,'0')}</span></div><h2>{q.prompt}</h2><div className="option-list">{q.options.map((option,j)=><button key={j} className={`option ${answers[q.id]===j?'option-selected':''}`} onClick={()=>setAnswers(a=>({...a,[q.id]:j}))}><span className="option-letter">{String.fromCharCode(65+j)}</span><span>{option}</span>{answers[q.id]===j&&<Check size={16}/>}</button>)}</div></section>)}
          <div className="quiz-submit"><span>{Object.keys(answers).length} of {quiz.length} answered</span><button className="button button-dark" disabled={busy} onClick={submitQuiz}>Submit for feedback <ArrowRight size={16}/></button></div>
        </div>:<section className="result-card"><div className="result-icon"><BadgeCheck size={25}/></div><div className="eyebrow">PRACTICE REVIEW</div><h2>{result.score} of {result.total} correct</h2><p className="result-percent">{result.percent}% <span>practice accuracy</span></p><p className="result-note">{result.note}</p><div className="answer-review">{result.detail.map((d,i)=>{const q=quiz.find(q=>q.id===d.questionId)!;return <div className={`answer-review-row ${d.correct?'answer-correct':'answer-missed'}`} key={d.questionId}><strong>{d.correct?'Correct':'Review'} · Question {i+1}</strong><p>{q.prompt}</p><small>{d.explanation}</small></div>})}</div><div className="result-actions"><button className="button button-dark" onClick={()=>{setResult(null);setAnswers({});}}>Try again</button><button className="button button-outline" onClick={()=>go('home')}>Return to course map</button></div></section>}
      </main>}

      {page==='tutor'&&<main className="content-page utility-page"><div className="eyebrow">A THOUGHTFUL STUDY COMPANION</div><h1>Ask a study question.</h1><p className="utility-intro">The tutor is designed to explain course ideas using the learning material—not to provide official exam answers or make decisions for you.</p><div className="tutor-panel"><div className="tutor-panel-head"><span className="tutor-icon"><Sparkles size={19}/></span><div><strong>Fahan learning tutor</strong><small>Course-grounded · Server-side connection</small></div>{tutorRemaining!==null&&<span className="usage-pill">{tutorRemaining} left today</span>}</div><form onSubmit={askTutor}><label htmlFor="tutor-question">What would you like to understand?</label><textarea id="tutor-question" value={tutorQuestion} onChange={e=>setTutorQuestion(e.target.value)} maxLength={2000} placeholder="For example: How can I make a handoff between teams more reliable?" required/><div className="form-foot"><span>{tutorQuestion.length}/2,000 · Please don’t include personal or confidential data.</span><button className="button button-dark" disabled={busy||!tutorQuestion.trim()}>{busy?'Thinking…':'Ask the tutor'} <ArrowRight size={16}/></button></div></form>{tutorAnswer&&<div className="tutor-answer"><div className="eyebrow">TUTOR RESPONSE</div><p>{tutorAnswer}</p></div>}<div className="config-hint"><ShieldCheck size={16}/><span>Connected only when a server administrator configures an Anthropic key. No simulated answers.</span></div></div><div className="privacy-callout"><LockKeyhole size={19}/><div><strong>Keep sensitive information out of prompts</strong><p>Use fictional examples and follow your organization’s data policy.</p></div></div></main>}

      {page==='pricing'&&<main className="content-page pricing-page"><div className="eyebrow">CONTINUE YOUR PRACTICE</div><h1>Room to grow, at your pace.</h1><p className="utility-intro">Start with a free lesson. Full-course membership is available only through a configured test-mode checkout.</p><section className="pricing-card"><div className="plan-copy"><div className="eyebrow">FAHAN ACADEMY · LEARNING MEMBERSHIP</div><h2>Full learning path</h2><p>All seven domains, lessons, practical exercises, and original knowledge checks. AI tutor access only when the service is configured.</p><ul><li><Check size={16}/>14 original practical lessons</li><li><Check size={16}/>21 scenario-based practice questions</li><li><Check size={16}/>Saved personal progress</li><li><Check size={16}/>Server-verified subscription entitlement</li></ul>      <div className="billing-state"><span className={`state-dot ${billing?.configured?'state-on':''}`}></span><div><strong>{billing?.state==='admin'?'Administrator access':billing?.state==='active'?'Membership active':billing?.configured?'Test checkout configured':'Not configured'}</strong><small>{billing?.message||'Checking configuration…'}</small></div></div>{billing?.state==='admin'?<button className="button button-outline" disabled>Administrator access <ShieldCheck size={16}/></button>:billing?.state==='active'?<button className="button button-dark" onClick={openPortal} disabled={!billing?.portalAvailable}>Manage membership <ExternalLink size={16}/></button>:<button className="button button-dark" disabled={!billing?.configured||busy} onClick={startCheckout}>{billing?.configured?'Continue to test checkout':'Checkout unavailable'} <ArrowRight size={16}/></button>}<p className="pricing-foot">Pricing and currency are intentionally not specified while business location and billing choices are undecided. No live payments are enabled.</p></div><div className="plan-art"><div className="plan-circle"><Leaf size={31}/></div><div className="plan-art-line line-one"></div><div className="plan-art-line line-two"></div><div className="plan-stamp"><span>LEARN<br/>WITH<br/>INTENTION</span></div><span className="plan-art-caption">a little progress<br/>adds up</span></div></section><div className="free-preview"><span><BookOpen size={18}/></span><div><strong>Free preview stays open</strong><p>Explore the first lesson and its practice quiz without payment. You can make an account to save your progress.</p></div><button className="text-button" onClick={()=>loadLesson('d1-l1')}>Open preview <ArrowRight size={15}/></button></div></main>}

      {page==='admin'&&<main className="content-page admin-page"><button className="back-link" onClick={()=>go('home')}><ArrowLeft size={16}/> Course map</button><div className="eyebrow">ADMINISTRATION</div><h1>Content studio</h1><p className="utility-intro">Edit lesson content. Changes are saved to the local database and apply to learners immediately.</p>{adminItems.length===0?<section className="admin-bootstrap"><span className="admin-shield"><ShieldCheck size={23}/></span><h2>Enable the first administrator</h2><p>Bootstrap is available only when the server has an admin key configured and no admin account exists. Keep the key private.</p><form onSubmit={bootstrapAdmin}><label htmlFor="bootstrap-key">One-time bootstrap key</label><input id="bootstrap-key" type="password" value={bootstrapKey} onChange={e=>setBootstrapKey(e.target.value)} required/><button className="button button-dark" disabled={busy}>Enable admin access</button></form></section>:<div className="admin-editor"><aside className="admin-list"><label htmlFor="admin-lesson">Choose a lesson</label><select id="admin-lesson" value={adminLessonId} onChange={e=>setAdminLessonId(e.target.value)}>{adminItems.map(l=><option key={l.id} value={l.id}>{String(l.domainId).padStart(2,'0')} · {l.title}</option>)}</select><p>{adminItems.length} lessons · quiz answer keys remain server controlled.</p></aside>{(()=>{const item=adminItems.find(x=>x.id===adminLessonId);return item?<form className="admin-form" onSubmit={saveLesson}><label>Lesson title<input name="title" defaultValue={item.title} key={`${item.id}-title`}/></label><label>Lesson text <small>Separate paragraphs with a blank line.</small><textarea name="body" rows={14} defaultValue={item.body.join('\n\n')} key={`${item.id}-body`}/></label><label>Practical exercise<textarea name="exercise" rows={3} defaultValue={item.exercise} key={`${item.id}-exercise`}/></label><button className="button button-dark" disabled={busy}>Save lesson changes <Check size={16}/></button></form>:null})()}</div>}</main>}
    </div>

    <footer className="site-footer"><div className="footer-brand"><span className="brand-mark"><Leaf size={16}/></span> fahan academy</div><div className="footer-links"><span>Independent learning resource</span><span>English</span><button onClick={()=>go('pricing')}>Membership</button></div><p>Not affiliated with, endorsed by, or a guarantee of any certification provider. Always verify current official materials.</p></footer>
    </div>

    <aside className="profile-panel" aria-label="Your learning profile">
      <div className="profile-heading"><h2>Your profile</h2><BadgeCheck size={18}/></div>
      <section className="profile-person">
        <div className="profile-ring" style={{background:`conic-gradient(#7c3cff ${progressPercent*3.6}deg, #eee8ff 0deg)`}}><div className="profile-avatar">{initials}<span className="profile-status"><Check size={10}/></span></div></div>
        <h3>{user?`Hello, ${user.name.split(' ')[0]}!`:'Hello, future achiever!'}</h3>
        <p>{user?'Your next breakthrough starts with a little practice.':'Your learning journey looks good on you.'}</p>
        {!user&&<button className="profile-signup" onClick={()=>{setAuthMode('register');setAuthOpen(true);}}>Create your account <ArrowRight size={13}/></button>}
        <div className="profile-shortcuts"><button className="icon-button" title="Open preview lesson" aria-label="Open preview lesson" onClick={()=>loadLesson('d1-l1')}><BookOpen size={16}/></button><button className="icon-button" title="Open AI tutor" aria-label="Open AI tutor" onClick={()=>go('tutor')}><MessageCircle size={16}/></button><button className="icon-button" title="View membership" aria-label="View membership" onClick={()=>go('pricing')}><GraduationCap size={17}/></button></div>
      </section>
      <section className="profile-progress"><div className="panel-section-heading"><h3>Your progress</h3><strong>{progressPercent}%</strong></div><div className="progress-track"><span style={{width:`${progressPercent}%`}}/></div><p>{completed} of {totalLessons} lessons complete</p></section>
      <section className="study-chart"><div className="panel-section-heading"><h3>Study emphasis</h3><span>BY DOMAIN</span></div><div className="chart-bars" role="img" aria-label={domains.map(d=>`Domain ${d.id}: ${d.weight}% study emphasis`).join('; ')}>{domains.map(d=><div className="chart-column" key={d.id}><div className="chart-track"><span style={{height:`${d.weight/25*100}%`}}/></div><small>D{d.id}</small></div>)}</div><p>Syllabus weights, not activity or scores.</p></section>
      <section className="study-focus"><div className="panel-section-heading"><h3>Your study focus</h3><Target size={16}/></div><div className="focus-list">{studyFocus.map(d=>{
        const Icon=domainIcons[d.id-1]||BookOpen;
        return <button className="focus-item" key={d.id} onClick={()=>loadQuiz(d.id)} title={`Practice ${d.title}`}><span className={`focus-icon domain-${d.color}`}><Icon size={16}/></span><span className="focus-copy"><strong>{d.title}</strong><small>Domain {String(d.id).padStart(2,'0')}</small></span><span className="focus-weight">{d.weight}%</span></button>;
      })}</div><button className="panel-all" onClick={openCourseMap}>See all domains <ArrowRight size={14}/></button></section>
      <div className="profile-tip"><Sparkles size={20}/><p>Consistency beats cramming.<br/><strong>You've got this.</strong></p></div>
    </aside>
    </div>

    {authOpen&&<div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setAuthOpen(false)}><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close icon-button" onClick={()=>setAuthOpen(false)} aria-label="Close"><X size={19}/></button><span className="auth-mark"><Leaf size={22}/></span><div className="eyebrow">YOUR LEARNING SPACE</div><h2 id="auth-title">{authMode==='register'?'Create your account':'Welcome back'}</h2><p>{authMode==='register'?'Save your progress and pick up where you left off.':'Sign in to continue your learning.'}</p><form onSubmit={authenticate}>{authMode==='register'&&<label>Your name<input name="name" autoComplete="name" minLength={2} maxLength={80} required placeholder="e.g. Alex Morgan"/></label>}<label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com"/></label><label>Password<input name="password" type="password" autoComplete={authMode==='register'?'new-password':'current-password'} minLength={authMode==='register'?10:1} maxLength={200} required placeholder={authMode==='register'?'At least 10 characters':'Your password'}/></label>{authError&&<div className="inline-error" role="alert">{authError}</div>}<button className="button button-dark auth-submit" disabled={authBusy}>{authBusy?'Please wait…':authMode==='register'?'Create account':'Sign in'} <ArrowRight size={16}/></button></form><div className="auth-switch">{authMode==='register'?'Already have an account?':'New to Fahan Academy?'} <button onClick={()=>{setAuthMode(authMode==='register'?'login':'register');setAuthError('');}}>{authMode==='register'?'Sign in':'Create an account'}</button></div><div className="auth-security"><LockKeyhole size={14}/> Passwords are securely hashed. No email service is configured.</div></section></div>}
    {toast&&<div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}
