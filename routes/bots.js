const express = require('express')
const fetch = require('node-fetch')
const timezone = require('moment-timezone')

const router = express.Router()
const validUrl = require('valid-url')
const tags = require('../utils/tags')
const bot = require('../utils/discordbot')
const { userToString, avatarFormat } = require('../utils/user')
const { captchaIsValid } = require('../utils/captcha')
const ImageCache = require('../utils/ImageCache').default
const colors = require('../utils/colors')
const { partialBotObject, partialSelect } = require('../utils/bot')
const { formatUrl } = require('../utils/avatar')
const { AppLibrary, BotsTags } = require('../modules/api/types')
function defaultInvite (id) {
  return `https://discord.com/api/v6/oauth2/authorize?client_id=${id}&scope=bot`
}

/**
*
* @param {*} config
* @param {Mongo} db
* @param {Api} api
*/
module.exports = (config, db, api) => {
  const dBot = bot(config)
  const cache = new ImageCache(api)

  async function getBotBy (idOrName) {
    return db.Bots.findOne({
      $or: [{ _id: idOrName }, { 'details.customURL': idOrName }]
    }).exec()
  }

  async function validateForm (body, botTags, owners) {
    if (!(await captchaIsValid(config.hcaptcha, body['h-captcha-response']))) {
      return 'O Captcha precisa ser validado.'
    }
    if (owners && owners.some((o) => Number.isNaN(o) || o.length !== 18)) {
      return 'Lista de donos inválida.'
    }
    if (Number.isNaN(body.id) || body.id.length !== 18) {
      return 'ID do bot fornecido é inválido.'
    }
    if (!body.library || !Object.values(AppLibrary).includes(body.library)) {
      return 'Biblioteca fornecida é inválida.'
    }
    if (body.webhook !== '0') {
      if (!validUrl.isUri(body.webhookurl)) {
        return 'O url do webhook não é valido.'
      }
      if (!['1', '2'].includes(body.webhook)) {
        return 'O tipo de WebHook escolhido é inválido.'
      }
      if (body.webhook === '2') {
        if (!body.authorization) {
          return 'Você tem que especificar o Authorization a ser enviado.'
        }
      }
    }
    if (body.server && body.server.length > 20) {
      return 'Link do servidor de suporte é inválido.'
    }
    if (!body.prefix || body.prefix.length > 15) {
      return 'Prefixo do bot é inválido.'
    }
    if (!body.shortdesc || body.shortdesc.length < 2 || body.shortdesc.length > 300) {
      return 'Descrição curta é inválida.'
    }
    if (body.longdesc && body.longdesc.length > 100000) {
      return 'Descrição longa é inválida.'
    }
    if (body.donate && !validUrl.isUri(body.donate)) {
      return 'O campo "Doação" precisa ser um link.'
    }
    if (body.custominvite && body.custominvite.length > 2083) {
      return 'Convite customizado é muito grande.'
    }
    const allTags = Object.values(BotsTags)
    if (
      !botTags.length ||
    botTags.length > 6 ||
    botTags.some((t) => !allTags.includes(t))
    ) {
      return 'Tags do bot é/são inválida(s).'
    }
  }

  function toBotDTO (b, owners, botTags) {
    const bot = {
      details: {
        prefix: b.prefix,
        tags: botTags,
        library: b.library,
        customInviteLink: b.custominvite || null,
        shortDescription: b.shortdesc,
        longDescription: b.longdesc || null,
        isHTML: b.ishtml === 'on',
        supportServer: b.server || null,
        website: b.website || null,
        otherOwners: owners,
        donate: b.donate || null,
        github: b.github || null
      }
    }
    if (b.webhook !== '0') {
      bot.webhook = {
        url: b.webhookurl || null,
        authorization: b.authorization || null,
        type: parseInt(b.webhook) || 0
      }
    } else {
      b.webhook = null
    }
    return bot
  }
  function stringToArray (string, forceArray = false) {
    if (forceArray || string) {
      return [
        ...new Set(typeof string === 'string' ? [string] : string || [])
      ]
    }
  }

  async function isAdm (sessionUser, bot, disableOwner = false) {
    if (!sessionUser) {
      return false
    }
    const user = await db.Users.findById(sessionUser.id).exec()
    if (!user || user.details.role < 1) {
      if (!disableOwner && sessionUser.id === (bot.owner._id || bot.owner)) {
        return true
      }
      return false
    }
    return true
  }

  router.get('/', (req, res) => {
    let { page } = req.query
    if (!page || Number.isNaN(page) || page < 1) { page = 1 }
    const params = {}
    const { search } = req.query
    if (search) {
      const regex = { $regex: search, $options: 'i' }
      params.$or = [{ username: regex }, { 'details.shortDescription': regex }]
    }
    params.$and = [{ approvedBy: { $ne: null } }]
    db.Bots.find(params).sort({ 'dates.sent': -1 }).select(partialSelect).limit(18)
      .skip((page - 1) * 18)
      .setOptions({
        allowDiskUse: true
      })
      .exec()
      .then((bots) => {
        res.render('bots/bots', {
          title: 'Bots', page, search, bots: (bots || []).map(partialBotObject)
        })
      })
  })

  router.get('/:id', (req, res) => {
    if (req.params.id === 'add') {
      if (!req.session.token) {
        req.session.path = req.originalUrl
        res.redirect('/oauth2/login')
        return
      }
      res.render('bots/add', {
        tags: BotsTags, title: 'Adicionar Bot', libraries: AppLibrary, captcha: config.hcaptcha.public
      })
      return
    }

    api
      .getBot(req.params.id)
      .then(async apiBot => {
        if (!apiBot.approvedBy) {
          if (!(await isAdm(req.session.user, apiBot))) {
            res.sendStatus(404)
            return
          }
        }
        const owner = await api.getUser(apiBot.owner)
        owner.avatarUrl = formatUrl(owner._id, owner.avatar)
        const otherOwners = []
        for (const id of apiBot.details.otherOwners || []) {
          try {
            const otherOwner = await api.getUser(id)
            otherOwner.avatarUrl = formatUrl(otherOwner._id, otherOwner.avatar)
            otherOwners.push(otherOwner)
          } catch (err) {
            console.error('Failed to get user', id, 'info:', err.message)
          }
        }

        const avatar = formatUrl(apiBot._id, apiBot.avatar)

        res.render('bots/bot', {
          bot: {
            avatar,
            id: apiBot._id,
            name: apiBot.username,
            tag: apiBot.discriminator,
            bio: apiBot.details.shortDescription,
            votes: apiBot.votes.current,
            tags: apiBot.details.tags,
            content: apiBot.details.htmlDescription,
            url: `/bots/${apiBot.details.customURL || apiBot._id}/`,
            support: apiBot.details.supportServer,
            website: apiBot.details.website,
            github: apiBot.details.github,
            donate: apiBot.details.donate,
            owners: [owner, ...otherOwners],
            prefix: apiBot.details.prefix,
            library: apiBot.details.library,
            guilds: apiBot.details.guilds ? `±${apiBot.details.guilds}` : '???'
          },
          title: apiBot.username,
          colors,
          tags,
          user: req.session.user
        })
      })
      .catch(error => {
        if (error.response?.status === 404) {
          res.sendStatus(404)
        } else {
          console.error('error showing', req.params.id, error.message)
        }
      })
  })

  router.get('/:id/add', (req, res) => {
    getBotBy(req.params.id).then(async (dbot) => {
      if (!dbot) {
        res.sendStatus(404)
        return
      }
      if (!dbot.approvedBy) {
        if (!(await isAdm(req.session.user, dbot))) {
          res.sendStatus(404)
          return
        }
      }
      res.redirect(dbot.details.customInviteLink || defaultInvite(dbot.id))
    })
  })

  router.get('/:id/remove', async (req, res) => {
    if (!req.session.user) {
      req.session.path = req.originalUrl
      res.redirect('/oauth2/login')
      return
    }

    const bot = await getBotBy(req.params.id)
    if (req.session.user.id !== bot.owner && req.session.user.role < 2) {
      res.sendStatus(403)
      return
    }

    res.render('bots/remove', {
      tag: userToString(bot),
      id: bot.id,
      hasReason: req.session.user.id !== bot.owner
    })
  })

  router.post('/delete', async (req, res) => {
    if (!req.session.token) {
      req.session.path = req.originalUrl
      res.redirect('/oauth2/login')
      return
    }
    const { id, reason } = req.body
    try {
      let result
      const bot = await api.getBot(id)
      if (req.session.user.id === bot.owner) {
        result = await api.removeBot(req.session.token, id)
      } else {
        result = await api.removeBotReason(req.session.token, id, reason || null)
      }

      if (result.deleted) {
        res.render('message', {
          title: 'Sucesso',
          message: 'O bot foi removido com sucesso.'
        })
      } else {
        res.render('message', {
          message: 'O bot não foi removido',
          url: '/bots/' + id
        })
      }
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        console.log(err.response)
        res.redirect('/oauth2/login')
      } else {
        console.error('Error trying to delete bot', err.message, err.response?.data)
        res.render('message', {
          message: 'Ocorreu um erro durante a remoção.',
          url: '/bots/' + id
        })
      }
    }
  })

  router.get('/:id/report', (req, res) => {
    const topics = [
      'Uso indevido de dados',
      'Spam',
      'MassDM',
      'Bot de baixa qualidade',
      'Vazamento de Token',
      'Outro'
    ]
    if (!req.session.user) {
      req.session.path = req.originalUrl
      res.redirect('/oauth2/login')
      return
    }
    getBotBy(req.params.id).then(async (dbot) => {
      if (!dbot) {
        res.sendStatus(404)
        return
      }
      if (!dbot || !dbot.approvedBy) {
        if (!(await isAdm(req.session.user, dbot))) {
          res.sendStatus(404)
          return
        }
      }
      res.render('bots/report',
        {
          captcha: config.hcaptcha.public,
          title: `Denunciar ${dbot.username}`,
          bot: { id: dbot.id, name: dbot.username },
          topics
        })
    })
  })

  router.post('/:id/report', async (req, res) => {
    try {
      if (!req.session.user || !req.session.token) {
        req.session.path = req.originalUrl
        res.redirect('/oauth2/login')
        return
      }
      if (!(await captchaIsValid(config.hcaptcha, req.body['h-captcha-response']))) {
        res.render('message', {
          message: 'O Captcha precisa ser validado.',
          url: req.originalUrl
        })
        return
      }

      api
        .report(
          req.session.token,
          req.params.id,
          req.body.topic,
          req.body.reason,
          req.files?.attachments)
        .then(({ bot }) => {
          res.render('message', {
            title: 'Sucesso',
            message: `Você denunciou o bot ${userToString(bot)} com sucesso.`,
            url: '/bots/' + req.params.id
          })
        })
        .catch((error) => {
          const { data } = error.response
          if (data.statusCode === 403) {
            req.session.destroy(() => {
              return res.render('message', {
                title: 'BANIDO',
                message: 'Você está banido! 🙂'
              })
            })
          } else {
            res.render('message', {
              message: 'Ocorreu um erro durante sua solicitação.',
              url: '/oauth2/login'
            })
          }
        })
    } catch (error) {
      console.error(error)
      res.render('message', {
        title: 'Erro interno',
        message: 'Ocorreu um erro interno enquanto processávamos sua solicitação, pedimos desculpas pela incoveniência.',
        url: '/oauth2/login'
      })
    }
  })

  router.get('/:id/votar', (req, res) => {
    if (!req.session.user) {
      req.session.path = req.originalUrl
      res.redirect('/oauth2/login')
      return
    }
    getBotBy(req.params.id).then(async (dbot) => {
      if (!dbot || !dbot.approvedBy) {
        if (!(await isAdm(req.session.user, dbot, true))) {
          res.sendStatus(404)
          return
        }
      }
      cache.saveCached(dbot).then(() => {
        res.render('bots/votar', {
          captcha: config.hcaptcha.public,
          title: `Vote em ${dbot.username}`,
          bot: {
            name: dbot.username,
            avatar: formatUrl(dbot.id, dbot.avatar)
          }
        })
      })
    })
  })

  router.post('/:id/votar', async (req, res) => {
    if (!req.session.user) {
      req.session.path = req.originalUrl
      res.redirect('/oauth2/login')
      return
    }
    if (!(await captchaIsValid(config.hcaptcha, req.body['h-captcha-response']))) {
      res.render('message', {
        message: 'O Captcha precisa ser validado.',
        url: req.originalUrl
      })
      return
    }
    db.Users.findById(req.session.user.id).then((user) => {
      if (user) {
        if (user.banned) {
          req.session.destroy(() => {
            return res.render('message', {
              title: 'BANIDO',
              message: 'Você está banido! 🙂',
              url: `/bots/${req.params.id}`
            })
          })
          return
        }
        const next = user.dates.nextVote
        const now = new Date()
        if (next && next > now) {
          if (next && next > now) {
            const time = timezone(next)
              .tz('America/Sao_Paulo')
              .locale('pt-br')
              .calendar()
              .toLowerCase()
            res.render('message', {
              message: `Você precisa esperar até ${time} (horário de Brasília) para poder votar novamente.`
            })
            return
          }
        }
        getBotBy(req.params.id).then(async (dot) => {
          if (!dot) {
            res.sendStatus(404)
            return
          }
          if (!dot || !dot.approvedBy) {
            if (!(await isAdm(req.session.user, dot, true))) {
              res.sendStatus(404)
              return
            }
          }
          now.setHours(now.getHours() + 8)
          user.dates.nextVote = now
          user.save()
          dot.votes.current += 1
          dot.votes.voteslog.push(user.id)
          dot.save()
          dBot.sendMessage(config.discord.bot.channels.botLogs, `${userToString(user)} (${user.id}) votou no bot \`${userToString(dot)}\`\n` +
              `${config.server.root}bots/${dot.details.customURL || dot.id}`)
          const setError = (error) => {
            getBotBy(dot.id).then(setBot => {
              setBot.webhook.lastError = error
              setBot.save()
            }
            )
          }
          if (dot.webhook) {
            switch (dot.webhook.type) {
              case 1: {
                const webhookMessage = {
                  embeds: [
                    {
                      title: 'Voto no Zuraaa! List',
                      description: `**${userToString(user)}** votou no bot **${userToString(dot)}**`,
                      color: 16777088,
                      footer: {
                        text: user.id
                      },
                      timestamp: new Date().toISOString(),
                      thumbnail: {
                        url: avatarFormat(user)
                      }
                    }
                  ]
                }
                fetch(dot.webhook.url, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(webhookMessage)
                }).then(res => {
                  setError(res.status >= 400)
                }).catch(() => {
                  setError(true)
                })
                break
              }
              case 2: {
                fetch(dot.webhook.url, {
                  method: 'POST',
                  headers: {
                    Authorization: dot.webhook.authorization,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    type: 'vote',
                    data: {
                      user_id: user.id,
                      bot_id: dot.id,
                      votes: dot.votes.current
                    }
                  })
                }).then(res => {
                  setError(res.status >= 400)
                }).catch(() => {
                  setError(true)
                })
                break
              }
            }
          }
          res.render('message', {
            title: 'Sucesso',
            message: `Você votou em ${dot.username} com sucesso.`,
            url: `/bots/${req.params.id}`
          })
        })
      }
    })
  })

  router.get('/:id/editar', (req, res) => {
    if (!req.session.token) {
      req.session.path = req.originalUrl
      res.redirect('/oauth2/login')
      return
    }
    api
      .getMe(req.session.token)
      .then(user => {
        getBotBy(req.params.id).then((dbot) => {
          if (!dbot) {
            res.sendStatus(404)
            return
          }
          if (![...dbot.details.otherOwners, dbot.owner].includes(user._id) && user.details.role < 2) {
            res.sendStatus(403)
            return
          }
          res.render('bots/editar', {
            bot: dbot, libraries: AppLibrary, tags: BotsTags, captcha: config.hcaptcha.public
          })
        })
      })
      .catch(err => {
        if (err.response?.status === 401) {
          req.session.path = req.originalUrl
          res.redirect('/oauth2/login')
        } else {
          console.log('Error getting user at edit', err.message)
          res.render('message', {
            message: 'Ocorreu um erro ao conseguir suas informações.'
          })
        }
      })
  })

  router.post('/editar', (req, res) => {
    if (!req.session.token) {
      req.session.path = req.originalUrl
      res.redirect('/oauth2/login')
      return
    }
    const botTags = stringToArray(req.body.tags, true)
    const owners = stringToArray(req.body.owners)
    validateForm(req.body, botTags, owners).then(async (result) => {
      if (result) {
        res.render('message', {
          message: result,
          url: '/bots/add'
        })
        return
      }
      api
        .editBot(req.session.token, req.body.id, toBotDTO(req.body, owners, botTags))
        .then(bot => {
          res.render('message', {
            title: 'Sucesso',
            message: `Você editou o bot ${userToString(bot)} com sucesso.`,
            url: `/bots/${req.body.id}`
          })
        })
        .catch((error) => {
          switch (error?.response.status) {
            case 400:
              console.error('Error 400 in edit bot:', error.response.data)
              res.render('message', {
                message: 'Erro durante a validação. Tem certeza que todos os campos estão corretos?',
                url: `/bots/${req.body.id}/editar`
              })
              break
            case 401:
            case 403:
              req.session.destroy(() => {
                res.session.path = req.originalUrl
              })
              res.redirect('/oauth2/login')
              break
            case 404:
              res.render('message', {
                message: 'Esse bot não foi encontrado.'
              })
              break
            default:
              console.error('Error in edit bot:', error.message)
              res.render('message', {
                message: 'Erro na aplicação.',
                url: `/bots/${req.body.id}/editar`
              })
              break
          }
        })
    })
  })

  router.post('/add', async (req, res) => {
    if (!req.session.token) {
      req.session.path = req.originalUrl
      res.redirect('/oauth2/login')
      return
    }

    const b = req.body
    const botTags = stringToArray(b.tags, true)
    const owners = stringToArray(b.owners)
    validateForm(b, botTags, owners).then(validateError => {
      if (validateError) {
        return res.render('message', {
          message: validateError
        })
      }
      const dto = toBotDTO(b, owners, botTags)
      dto._id = b.id
      api
        .sendBot(req.session.token, dto)
        .then(bot => {
          res.render('message', {
            title: 'Sucesso',
            message: `O bot ${userToString(bot)} foi enviado para a fila de verificação.`,
            url: `/bots/${b.id}`
          })
        })
        .catch(error => {
          switch (error.response?.status) {
            case 400: {
              const { data } = error.response
              if (data.idError) {
                res.render('message', {
                  message: `O ${data.bot ? 'bot' : 'usuário'} de ID ${data.id} é inválido.`,
                  url: '/bots/add'
                })
                return
              }
              res.render('message', {
                message: 'Ocorreu um erro durante a validação dos dados.',
                url: '/bots/add'
              })
              break
            }
            case 401:
            case 403:
              req.session.destroy()
              res.redirect('/oauth2/login')
              break
            default:
              console.error('Error adding bot: ', error.message, error.response?.status, error.response?.data)
              res.render('message', {
                message: 'Ocorreu um erro na aplicação.',
                url: '/bots/add'
              })
              break
          }
        })
    })
  })
  return router
}
