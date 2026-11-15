#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const server=fs.readFileSync('functions/server.js','utf8');
const parents=fs.readFileSync('parents.html','utf8');
const dashboard=fs.readFileSync('dashboard.html','utf8');
const worksheets=fs.readFileSync('worksheets.html','utf8');
let failed=0; const test=(name,ok)=>{console.log(`${ok?'✅':'❌'} ${name}`);if(!ok)failed++};
test('pack access has parent-child primary key and cascades',/CREATE TABLE IF NOT EXISTS family_learning_pack_access[\s\S]{0,500}PRIMARY KEY \(parent_user_id, child_user_id\)/.test(server)&&/family_learning_pack_access[\s\S]{0,300}ON DELETE CASCADE/.test(server));
test('parent list requires a verified parent and Premium entitlement',/router\.get\('\/parents\/:parentId\/family-learning-pack'[\s\S]{0,500}requireVerifiedParent[\s\S]{0,300}requirePremiumFamilyPack/.test(server));
test('pack changes are parent-authenticated, owned and boolean-only',/router\.put\('\/parents\/children\/:childUserId\/family-learning-pack', parentWriteLimiter[\s\S]{0,800}typeof req\.body\?\.enabled !== 'boolean'[\s\S]{0,500}getOwnChild/.test(server));
test('learner pack route is self-scoped with no child identifier',/router\.get\('\/family-learning-pack\/me'[\s\S]{0,1000}WHERE c\.user_id = \$1/.test(server));
test('learner pack recalculates the linked parent entitlement',/family-learning-pack\/me[\s\S]{0,1200}requirePremiumFamilyPack\(res, link\.parent_user_id\)/.test(server));
test('pack vocabulary is queried only for the target child and capped',/buildFamilyLearningPack\(childUserId\)[\s\S]{0,700}WHERE user_id = \$1[\s\S]{0,300}LIMIT 8/.test(server));
test('Premium worksheet download requires authenticated server entitlement before count',/worksheets\/download\/:id[\s\S]{0,400}requireUser[\s\S]{0,1100}worksheet\.premium[\s\S]{0,700}hasAccess\(entitlement, 'premium'\)[\s\S]{0,600}download_count/.test(server));
test('Parent Hub visibly controls Family Learning Pack',/Premium Family Learning Pack/.test(parents)&&/saveFamilyLearningPack/.test(parents)&&/family-learning-pack/.test(parents));
test('Learner dashboard shows pack only from server result',/id="familyPackCard" hidden/.test(dashboard)&&/request\("family-learning-pack\/me"\)/.test(dashboard));
test('worksheets no longer use starter fallback words',!/var FALLBACK=/.test(worksheets)&&/family-learning-pack\/me/.test(worksheets));
test('worksheets escape server-supplied words',/var esc=function/.test(worksheets)&&/esc\(w\.word\)/.test(worksheets));
for(const [file,source] of [['parents.html',parents],['dashboard.html',dashboard],['worksheets.html',worksheets]]){try{for(const[,script]of source.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g))new Function(script);test(`${file} inline scripts parse`,true)}catch(e){test(`${file} inline scripts parse`,false)}}
console.log(`\n${failed?`❌ ${failed} failure(s)`:'✅ Family Learning Pack checks passed'}`);process.exit(failed?1:0);
