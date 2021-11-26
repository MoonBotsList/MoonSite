const express = require('express')

const router = express.Router()
const ImageCache = require('../utils/ImageCache').default
const { captchaIsValid } = require('../utils/captcha')
const { formatUrl } = require('../utils/avatar')

/**
 *
 * @param {*} config
 * @param {Mongo} mongo
 */
module.exports = (config, mongo, api) => {
  const cache = new ImageCache(api)

  function generateUrl () {
    return `${config.oauth.urls.authorization}?client_id=${config.oauth.client.id}` +
        `&redirect_uri=${encodeURIComponent(config.oauth.urls.redirect)}&response_type=code&scope=identify`
  }

  async function saveData (user) {
    const userFind = await mongo.Users.findById(user._id).exec()
    return await (await cache.saveCached(userFind, false)).save()
  }

  router.get('/login', (req, res) => {
    res.redirect(generateUrl(config))
  })

  router.get('/callback', (req, res) => {
    const { code } = req.query
    if (code) {
      res.render('login', {
        captcha: config.hcaptcha.public,
        code
      })
    } else {
      res.redirect('/oauth2/login')
    }
  })

  router.post('/callback', (req, res) => {
    const { code, ...captcha } = req.body
    if (code && captchaIsValid(config.hcaptcha, captcha)) {
      try {
        api.login(code).then(({ access_token: token }) => {
          if (!token) {
            res.redirect('/oauth2/login')
          }
          api.getMe(token).then(async user => {
            req.session.token = token
            req.session.user = {
              id: user._id,
              username: user.username,
              discriminator: user.discriminator,
              avatar: user.avatar
            }
            const x = await saveData(user)
            req.session.user.role = x.id === config.discord.ownerId ? 3 : x.details.role
            req.session.user.buffer = formatUrl(x.id, x.avatar)
            req.session.save(() => res.redirect(req.session.path || '/'))
          })
        })
          .catch((error) => {
            console.error('Error during login', error.message, error.response?.data)
            if (error.response?.status === 403) {
              req.session.destroy()
              res.render('message', {
                title: 'BANIDO',
                message: 'Você está banido! 🙂'
              })
            } else {
              res.render('message', {
                message: 'Ocorreu um erro durante o login.',
                url: '/oauth2/login'
              })
            }
          })
      } catch (error) {
        const { data } = error.response
        if (data.statusCode === 403) {
          req.session.destroy(() => {
            return res.render('message', {
              title: 'BANIDO',
              message: 'Você está banido! 🙂'
            })
          })
          return
        }
        res.redirect('/oauth2/login')
      }
    } else {
      res.redirect('/oauth2/login')
    }
  })

  router.get('/logout', (req, res) => {
    req.session.destroy()
    res.redirect('/')
  })

  return router
}
