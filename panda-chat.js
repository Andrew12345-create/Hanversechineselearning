function togglePanda(){

document
.getElementById('pandaChat')
.classList
.toggle('active');

}
async function sendPandaMessage(){

const input =
document.getElementById('pandaInput');

const body =
document.getElementById('pandaBody');

const message =
input.value.trim();

if(!message) return;

body.innerHTML += `
<div class="message user-message">
${message}
</div>
`;

input.value='';

body.innerHTML += `
<div id="typingIndicator" class="message-row">

<div class="panda-avatar">
🐼
</div>

<div class="typing">
<span></span>
<span></span>
<span></span>
</div>

</div>
`;

body.scrollTop =
body.scrollHeight;

try{

const response =
await fetch('/api/panda-chat',{
method:'POST',
headers:{
'Content-Type':'application/json'
},
body:JSON.stringify({
message
})
});

const data =
await response.json();

document
.getElementById(
'typingIndicator'
)
?.remove();

body.innerHTML += `
<div class="message-row">

<div class="panda-avatar">
🐼
</div>

<div class="message panda-message">
${data.reply || 'No response'}
</div>

</div>
`;

body.scrollTop =
body.scrollHeight;

}
catch(error){

document
.getElementById(
'typingIndicator'
)
?.remove();

body.innerHTML += `
<div class="message panda-message">
❌ Panda unavailable
</div>
`;

}

}
