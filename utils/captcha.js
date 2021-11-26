const fetch = require('node-fetch')

async function captchaIsValid (config, response) {
  // Ativar/Desativar verificação do captcha nas configs para testar add bot rapidamente.
  if (!config.enabled) {
    return true
  }
  const body = new URLSearchParams({
    secret: config.secret,
    response
  })
  const res = await (await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })).json()
  return res.success
}

module.exports = {
  captchaIsValid
}
