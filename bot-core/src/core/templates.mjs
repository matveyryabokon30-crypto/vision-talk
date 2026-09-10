export const templates = [
  {
    id:'intake', name:'Заявка на консультацию', description:'Собирает имя, контакт и предпочтение. Не бронирует календарь и не обещает свободное время.',
    flow:{version:1,start:'hello',nodes:{
      hello:{type:'say',text:'Помогу оставить заявку. Контакт получит владелец бота. Это не подтверждение записи. Для отмены: /cancel.',next:'name'},
      name:{type:'ask',field:'name',text:'Как к вам обращаться?',min:2,max:80,next:'contact'},
      contact:{type:'ask',field:'contact',validation:'email',text:'Укажите почту для ответа.',next:'period'},
      period:{type:'choice',field:'period',text:'Когда вам удобнее?',options:[{id:'morning',label:'Утром',next:'confirm'},{id:'evening',label:'Вечером',next:'confirm'}]},
      confirm:{type:'choice',field:'consent',text:'{{name}}, отправить владельцу заявку: {{contact}}, {{period}}?',options:[{id:'yes',label:'Отправить заявку',next:'store'},{id:'no',label:'Не отправлять',next:'cancelled'}]},
      store:{type:'save',kind:'consultation_request',next:'done'},
      done:{type:'end',text:'Заявка сохранена. Запись ещё не подтверждена: дождитесь ответа специалиста. Новый запрос: /start.'},
      cancelled:{type:'end',text:'Заявка не отправлена. Новый запрос: /start.'}
    }}
  },
  {
    id:'help',name:'Справка и навигация',description:'Разделы, ответы и возврат в меню. Без искусственного интеллекта.',
    flow:{version:1,start:'menu',nodes:{
      menu:{type:'choice',field:'topic',text:'Какой раздел открыть?',options:[{id:'about',label:'Как это работает',next:'about'},{id:'privacy',label:'Мои данные',next:'privacy'},{id:'finish',label:'Закончить',next:'done'}]},
      about:{type:'say',text:'Это самостоятельный сценарный бот. Его движок работает без Telegram и платной модели ИИ.',next:'menu'},
      privacy:{type:'say',text:'Сообщения сохраняются на сервере этого бота. Не отправляйте секреты. Владелец получает только результаты, явно отправленные сценарием.',next:'menu'},
      done:{type:'end',text:'До следующего обращения. Начать заново: /start.'}
    }}
  }
];
export const getTemplate = id => templates.find(t => t.id === id);
