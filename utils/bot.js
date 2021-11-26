const { formatUrl } = require('./avatar')

function partialBotObject (bot) {
  const id = bot.id || bot._id
  return {
    tags: bot.details.tags,
    avatar: formatUrl(id, bot.avatar),
    name: bot.username,
    id,
    prefix: bot.details.prefix,
    status: bot.status,
    description: bot.details.shortDescription,
    votes: bot.votes ? bot.votes.current : -1,
    guilds: bot.details.guilds ? `±${bot.details.guilds}` : undefined,
    baseUrl: `/bots/${bot.details.customURL || id}/`
  }
}

function botObjectSender (bot) {
  return {
    _id: bot._id,
    username: bot.username,
    discriminator: bot.discriminator,
    owner: bot.owner,
    avatar: bot.avatar,
    status: bot.status,
    dates: {
      sent: bot.dates.sent
    },
    details: bot.details,
    votes: {
      current: bot.votes.current,
      voteslog: bot.votes.voteslog
    }
  }
}

module.exports = {
  partialBotObject,
  partialSelect: 'details.tags username status details.shortDescription votes.current details.customURL details.guilds avatar',
  botObjectSender
}
