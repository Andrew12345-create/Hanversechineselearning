#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
const f=fs.readFileSync('functions/features.js','utf8'), c=fs.readFileSync('class.html','utf8'), client=fs.readFileSync('features-client.js','utf8');let bad=0;const t=(n,v)=>{console.log(`${v?'✅':'❌'} ${n}`);if(!v)bad++};
t('schema stores classroom assignments',/CREATE TABLE IF NOT EXISTS class_assignments/.test(f));
t('reads require authenticated class membership',/router\.get\('\/classroom\/assignments\/:classCode', requireAuth[\s\S]{0,250}loadClassForViewer/.test(f));
t('creation requires a teacher',/router\.post\('\/classroom\/assignments', requireAuth, writeLimiter[\s\S]{0,220}requireTeacher/.test(f));
t('creation verifies teacher owns that class',/classrooms WHERE class_code = \$1 AND teacher_id = \$2/.test(f));
t('completion requires current class membership',/JOIN users u ON u\.class_code = a\.class_code[\s\S]{0,120}u\.user_id = \$2/.test(f));
t('completion is unique per learner',/PRIMARY KEY \(assignment_id, learner_user_id\)/.test(f));
t('client uses authenticated API helpers',/createAssignment:.*api\('\/classroom\/assignments'/.test(client));
t('classroom visibly renders assignments',/function renderAssignments/.test(c)&&/Create class assignment/.test(c));
t('student completion control is visible and scoped to assignment id',/data-complete-assignment/.test(c));
console.log(`\n${bad?`❌ ${bad} failure(s)`:'✅ class assignment checks passed'}`);process.exit(bad?1:0);
