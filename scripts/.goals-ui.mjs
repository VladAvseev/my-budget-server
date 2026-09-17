import express from 'express';
import { resolve } from 'node:path';
import { pool } from '../src/db/pool.js';
import { goalsController as goals } from '../src/modules/_goals/controller.js';
import { accountsController as accounts } from '../src/modules/_accounts/controller.js';
import { reportsController as reports } from '../src/modules/_reports/controller.js';
import { operationsController as operations } from '../src/modules/_operations/controller.js';
import { categoriesController as categories } from '../src/modules/_categories/controller.js';
import { errorMiddleware } from '../src/middlewares/errorMiddleware.js';
if (process.env.DATABASE_URL !== 'postgresql://postgres@127.0.0.1:55439/goals_check') throw Error('Только тестовая БД');
const owner = (await pool.query("SELECT id FROM public.users WHERE login='goals-owner'")).rows[0].id;
// Фикстура добавляет поля runtime, которых нет в schema.sql.
await pool.query(`ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS code text DEFAULT '', ADD COLUMN IF NOT EXISTS period_start date, ADD COLUMN IF NOT EXISTS period_end date;
ALTER TABLE public.reports ALTER COLUMN type SET DEFAULT 'custom', ALTER COLUMN data SET DEFAULT '{}';
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.operations ADD COLUMN IF NOT EXISTS date date; ALTER TABLE public.operations ALTER COLUMN date DROP NOT NULL;`);
const primary = (await pool.query('SELECT id FROM public.accounts WHERE user_id=$1 AND is_primary',[owner])).rows[0].id;
await pool.query('UPDATE public.accounts SET initial_balance=10000 WHERE id=$1',[primary]);
await pool.query("INSERT INTO public.accounts(user_id,name,initial_balance) SELECT $1,'Отпуск',500 WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE user_id=$1 AND name='Отпуск')",[owner]);
await pool.query("INSERT INTO public.accounts(user_id,name) SELECT $1,'Резерв' WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE user_id=$1 AND name='Резерв')",[owner]);
for (let m=1;m<=9;m++) {
 const month=String(m).padStart(2,'0');
 const existing=await pool.query('SELECT id FROM public.reports WHERE user_id=$1 AND code=$2',[owner,`2026-${month}`]);
 if(existing.rowCount) continue;
 const r=await pool.query("INSERT INTO public.reports(user_id,name,code,period_start,period_end) VALUES($1,$2,$3,$4,$5) RETURNING id",[owner,`Период ${month}`,`2026-${month}`,`2026-${month}-01`,`2026-${month}-${m===2?28:[4,6,9].includes(m)?30:31}`]);
 if(m<9) await pool.query("INSERT INTO public.operations(user_id,report_id,account_id,type,amount) VALUES($1,$2,$3,'income',200)",[owner,r.rows[0].id,primary]);
}
await pool.query("INSERT INTO public.operations(user_id,report_id,account_id,type,amount) SELECT $1,r.id,$2,'income',200 FROM public.reports r WHERE r.user_id=$1 AND r.period_start<'2026-09-01' AND NOT EXISTS(SELECT 1 FROM public.operations o WHERE o.report_id=r.id)",[owner,primary]);
const user={id:owner,login:'goals-owner',role:'user',currency:'RUB',onboarded:true,lastActiveAt:null,createdAt:'2026-01-01T00:00:00+03:00',updatedAt:new Date().toISOString()};
const app=express();app.use(express.json());
app.post('/api/v1/auth/login',(_req,res)=>res.json({data:{accessToken:'local-goals-test',refreshToken:'local-test',expiresIn:86400,user}}));
app.use('/api', (req,_res,next)=>{req.user={id:owner};next();});
app.get('/api/v1/users/me',(_req,res)=>res.json({data:user}));
app.get('/api/v1/consent/status',(_req,res)=>res.json({data:{needsConsent:false,reason:null,currentVersion:null,grantedVersion:null}}));
app.get('/api/v1/users/me/bootstrap',(_req,res)=>res.json({data:{profile:user,onboarding:{categories:2,reports:9,operations:8},lastReport:null,globalTotals:{income:1600,expense:0}}}));
app.get('/api/v1/users/me/settings',(_req,res)=>res.json({data:{}}));
app.get('/api/v1/users/me/summary',(_req,res)=>res.json({data:{income:1600,expense:0}}));
for(const [resource,controller] of [['goals',goals],['accounts',accounts],['operations',operations],['categories',categories]]){
 app.get(`/api/v1/${resource}`,controller.list);app.post(`/api/v1/${resource}`,controller.create);app.patch(`/api/v1/${resource}/:id`,controller.update);app.delete(`/api/v1/${resource}/:id`,controller.remove);
}
app.get('/api/v1/reports/capital-dynamics',reports.getCapitalDynamics);
app.get('/api/v1/reports',reports.list);
app.get('/api/v1/reports/:id',reports.getById);
app.get('/api/v1/reports/:id/summary',reports.getSummary);
app.get('/api/v1/reports/:id/category-limits',(_req,res)=>res.json({data:[]}));
app.use('/api',(req,res)=>{console.warn('Необслуженный маршрут стенда',req.method,req.originalUrl);res.status(404).json({error:{message:'Маршрут стенда не настроен'}});});
app.use(errorMiddleware);
app.use(express.static(resolve('../client/dist')));
app.get('*',(_req,res)=>res.sendFile(resolve('../client/dist/index.html')));
const server=app.listen(5501,'127.0.0.1',()=>console.warn('Стенд целей: http://127.0.0.1:5501/capital'));
process.on('SIGINT',()=>{server.close();void pool.end().then(()=>process.exit());});
